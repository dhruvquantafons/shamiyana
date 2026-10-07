#!/usr/bin/env node
// Assembles desktop/.pack, the app folder electron-builder packs into
// app.asar: the main-process code with production dependencies only, the
// licence public key compiled into lib/license.js, and the JavaScript
// obfuscated so the licence checks are not trivial to read or patch.

import { execSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import JavaScriptObfuscator from "javascript-obfuscator";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "..");
const pack = join(desktop, ".pack");

rmSync(pack, { recursive: true, force: true });
mkdirSync(pack);
for (const entry of ["main.js", "preload.js", "contact.json", "lib", "ui", "sql"]) {
  cpSync(join(desktop, entry), join(pack, entry), { recursive: true });
}

// The public key as a literal: a .pem beside the code could simply be swapped
// for one whose private key the client holds.
const licensePath = join(pack, "lib", "license.js");
const pem = readFileSync(join(desktop, "license-public.pem"), "utf8");
const source = readFileSync(licensePath, "utf8");
const keyRead = 'fs.readFileSync(path.join(__dirname, "..", "license-public.pem"), "utf8")';
if (!source.includes(keyRead)) throw new Error("license.js no longer reads the public key the way pack.mjs expects");
writeFileSync(licensePath, source.replace(keyRead, JSON.stringify(pem)));

const own = JSON.parse(readFileSync(join(desktop, "package.json"), "utf8"));
writeFileSync(
  join(pack, "package.json"),
  JSON.stringify({
    name: own.name,
    productName: own.productName,
    version: own.version,
    description: own.description,
    author: own.author,
    main: own.main,
    dependencies: own.dependencies,
  }, null, 2),
);
execSync("npm install --omit=dev --no-package-lock --no-audit --no-fund", { cwd: pack, stdio: "inherit" });

function* jsFiles(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* jsFiles(p);
    else if (p.endsWith(".js")) yield p;
  }
}

for (const file of jsFiles(pack)) {
  const heavy = file.endsWith(join("lib", "license.js"));
  const result = JavaScriptObfuscator.obfuscate(readFileSync(file, "utf8"), {
    target: file.includes(`${join(pack, "ui")}`) ? "browser" : "node",
    compact: true,
    identifierNamesGenerator: "hexadecimal",
    stringArray: true,
    stringArrayEncoding: ["base64"],
    stringArrayThreshold: 1,
    splitStrings: heavy,
    controlFlowFlattening: heavy,
    controlFlowFlatteningThreshold: 0.5,
    deadCodeInjection: heavy,
    deadCodeInjectionThreshold: 0.2,
    selfDefending: heavy,
  });
  writeFileSync(file, result.getObfuscatedCode());
}

console.log(`Packed ${pack}`);
