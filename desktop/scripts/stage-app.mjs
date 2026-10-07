#!/usr/bin/env node
// Builds the Next.js app for the desktop demo and stages it:
//
//   .stage/app/                 Next standalone server (+ public, .next/static)
//   .stage/migrations/          supabase/migrations/*.sql
//   .stage/build-secrets.json   JWT secret, anon + service-role keys, demo.env
//
// The JWT secret is generated once into desktop/.secrets and reused, so a
// rebuilt installer keeps existing sign-ins valid. Test-mode integration keys
// come from desktop/demo.env (see demo.env.example).
//
// Build on the platform you ship for: Next's standalone output carries
// platform-specific native modules (sharp), so the Windows installer must be
// staged on Windows — the GitHub workflow does this.

import { execSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(desktop, "..");
const stage = join(desktop, ".stage");

const GATEWAY_URL = "http://127.0.0.1:54321";
const APP_URL = "http://127.0.0.1:54330";

// Integration settings demo.env may carry into the app.
const APP_ENV_KEYS = [
  "RESEND_API_KEY", "NOTIFY_FROM_EMAIL",
  "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER",
  "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET",
  "DEMO_2FA_CODE",
];

function jwt(payload, secret) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = `${enc({ alg: "HS256", typ: "JWT" })}.${enc(payload)}`;
  return `${head}.${createHmac("sha256", secret).update(head).digest("base64url")}`;
}

function jwtSecret() {
  const file = join(desktop, ".secrets", "jwt-secret");
  if (process.env.DESKTOP_JWT_SECRET) return process.env.DESKTOP_JWT_SECRET;
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  mkdirSync(dirname(file), { recursive: true });
  const secret = randomBytes(48).toString("base64url");
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

function demoEnv() {
  const file = join(desktop, "demo.env");
  const env = {};
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
    }
  }
  // CI passes the same names as environment variables (GitHub secrets).
  for (const key of APP_ENV_KEYS) if (process.env[key]) env[key] = process.env[key];
  return Object.fromEntries(APP_ENV_KEYS.filter((k) => env[k]).map((k) => [k, env[k]]));
}

const secret = jwtSecret();
const iat = Math.floor(Date.now() / 1000);
const exp = iat + 10 * 365 * 24 * 60 * 60;
const anonKey = jwt({ iss: "supabase", role: "anon", iat, exp }, secret);
const serviceRoleKey = jwt({ iss: "supabase", role: "service_role", iat, exp }, secret);
const appEnv = demoEnv();

// Guest-portal one-time codes through Resend's SMTP relay, when there is a key.
const fromAddress = appEnv.NOTIFY_FROM_EMAIL?.match(/<([^>]+)>/)?.[1] ?? appEnv.NOTIFY_FROM_EMAIL;
const smtp = appEnv.RESEND_API_KEY && fromAddress
  ? { host: "smtp.resend.com", port: 587, user: "resend", pass: appEnv.RESEND_API_KEY, from: fromAddress }
  : null;

console.log("Building the app (next build)…");
execSync("npx next build", {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    DEMO_BUILD: "1",
    NEXT_PUBLIC_LOCAL_DEMO: "1",
    NEXT_PUBLIC_SUPABASE_URL: GATEWAY_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    NEXT_PUBLIC_SITE_URL: APP_URL,
    NEXT_TELEMETRY_DISABLED: "1",
  },
});

const app = join(stage, "app");
rmSync(app, { recursive: true, force: true });
cpSync(join(root, ".next", "standalone"), app, { recursive: true, verbatimSymlinks: true });
cpSync(join(root, ".next", "static"), join(app, ".next", "static"), { recursive: true });
cpSync(join(root, "public"), join(app, "public"), { recursive: true });

// The standalone server loads .env files beside it at run time. The repo's
// own (hosted Supabase, production keys) must never reach the installer.
for (const file of readdirSync(app)) {
  if (file.startsWith(".env")) rmSync(join(app, file), { force: true });
}

const migrations = join(stage, "migrations");
rmSync(migrations, { recursive: true, force: true });
cpSync(join(root, "supabase", "migrations"), migrations, { recursive: true });

writeFileSync(
  join(stage, "build-secrets.json"),
  JSON.stringify({ jwtSecret: secret, anonKey, serviceRoleKey, appEnv, smtp }, null, 2),
);
console.log(`Staged the app; integrations from demo.env: ${Object.keys(appEnv).join(", ") || "none"}.`);
