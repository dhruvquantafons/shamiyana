#!/usr/bin/env node
// Puts the database programs into desktop/.stage for the target platform:
//
//   .stage/pgsql/                PostgreSQL (bin, lib, share)
//   .stage/bin/postgrest[.exe]   PostgREST
//   .stage/bin/gotrue[.exe]      Supabase Auth, built from source (needs Go)
//   .stage/gotrue-migrations/    Supabase Auth's schema migrations
//
// Versions match Supabase's own self-hosted stack (supabase/docker).
//
//   node scripts/stage-runtime.mjs                  # for this computer (development)
//   node scripts/stage-runtime.mjs --target win32   # for the Windows installer
//
// On macOS, development uses the PostgreSQL already installed (PG_HOME,
// default /Library/PostgreSQL/18) instead of downloading one.

import { execFileSync } from "node:child_process";
import { cpSync, createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import extract from "extract-zip";

const VERSIONS = {
  postgres: "17.11-1",
  postgrest: "v14.17",
  gotrue: "v2.196.0",
};

const { values } = parseArgs({ options: { target: { type: "string", default: process.platform } } });
const target = values.target;
const win = target === "win32";
const exe = (name) => (win ? `${name}.exe` : name);

const desktop = join(dirname(fileURLToPath(import.meta.url)), "..");
const stage = join(desktop, ".stage");
const cache = join(desktop, ".cache");
mkdirSync(join(stage, "bin"), { recursive: true });
mkdirSync(cache, { recursive: true });

async function download(url, file) {
  if (existsSync(file)) return file;
  console.log(`  downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  await pipeline(res.body, createWriteStream(`${file}.part`));
  cpSync(`${file}.part`, file);
  rmSync(`${file}.part`);
  return file;
}

async function stagePostgres() {
  const dest = join(stage, "pgsql");
  rmSync(dest, { recursive: true, force: true });
  if (!win) {
    const home = process.env.PG_HOME || "/Library/PostgreSQL/18";
    if (!existsSync(join(home, "bin", "postgres"))) throw new Error(`No PostgreSQL at ${home}; set PG_HOME.`);
    symlinkSync(home, dest);
    console.log(`postgres: using ${home}`);
    return;
  }
  const zip = await download(
    `https://get.enterprisedb.com/postgresql/postgresql-${VERSIONS.postgres}-windows-x64-binaries.zip`,
    join(cache, `postgresql-${VERSIONS.postgres}-windows-x64-binaries.zip`),
  );
  const tmp = join(tmpdir(), `pg-${process.pid}`);
  await extract(zip, { dir: tmp });
  // Only what the server needs: no pgAdmin, StackBuilder, docs, headers, symbols.
  mkdirSync(dest, { recursive: true });
  for (const part of ["bin", "lib", "share"]) cpSync(join(tmp, "pgsql", part), join(dest, part), { recursive: true });
  for (const junk of ["bin/pgAdmin 4", "bin/stackbuilder.exe", "share/doc"]) {
    rmSync(join(dest, junk), { recursive: true, force: true });
  }
  rmSync(tmp, { recursive: true, force: true });
  console.log(`postgres: ${VERSIONS.postgres}`);
}

async function stagePostgrest() {
  const v = VERSIONS.postgrest;
  const asset = win
    ? `postgrest-${v}-windows-x86-64.zip`
    : `postgrest-${v}-macos-${process.arch === "arm64" ? "aarch64" : "x86-64"}.tar.xz`;
  const file = await download(`https://github.com/PostgREST/postgrest/releases/download/${v}/${asset}`, join(cache, asset));
  const tmp = join(tmpdir(), `pgrst-${process.pid}`);
  mkdirSync(tmp, { recursive: true });
  if (asset.endsWith(".zip")) await extract(file, { dir: tmp });
  else execFileSync("tar", ["-xf", file, "-C", tmp]);
  cpSync(join(tmp, exe("postgrest")), join(stage, "bin", exe("postgrest")));
  rmSync(tmp, { recursive: true, force: true });
  console.log(`postgrest: ${v}`);
}

function stageGotrue() {
  const v = VERSIONS.gotrue;
  const src = join(cache, `auth-${v}`);
  if (!existsSync(src)) {
    execFileSync("git", ["-c", "advice.detachedHead=false", "clone", "-q", "--depth", "1", "--branch", v, "https://github.com/supabase/auth.git", src], { stdio: "inherit" });
    // Supabase Auth sets SO_REUSEPORT, which Windows does not have.
    execFileSync("git", ["apply", join(desktop, "patches", "gotrue-windows.patch")], { cwd: src, stdio: "inherit" });
  }
  execFileSync("go", ["build", "-ldflags", `-s -w -X github.com/supabase/auth/internal/utilities.Version=${v}`, "-o", join(stage, "bin", exe("gotrue")), "."], {
    cwd: src,
    stdio: "inherit",
    env: { ...process.env, CGO_ENABLED: "0", GOOS: win ? "windows" : process.platform, GOARCH: win ? "amd64" : process.arch === "arm64" ? "arm64" : "amd64" },
  });
  const migrations = join(stage, "gotrue-migrations");
  rmSync(migrations, { recursive: true, force: true });
  cpSync(join(src, "migrations"), migrations, { recursive: true });
  console.log(`gotrue: ${v} (${readdirSync(migrations).length} migrations)`);
}

console.log(`Staging runtime for ${target}`);
await stagePostgres();
await stagePostgrest();
stageGotrue();
console.log("Done.");
