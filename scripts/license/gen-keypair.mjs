#!/usr/bin/env node
// Creates the Ed25519 key pair that signs desktop-demo activation keys. Run
// once. The public key goes into the app (desktop/license-public.pem, safe
// to commit); the private key stays on your computer, outside the repo.
// Anyone holding the private key can issue keys — back it up and keep it secret.
//
//   node scripts/license/gen-keypair.mjs

import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const privatePath = process.env.SHAMIYANA_LICENSE_KEY || join(homedir(), ".shamiyana-license", "private.pem");
const publicPath = join(root, "desktop", "license-public.pem");

if (existsSync(privatePath)) {
  console.error(`A private key already exists at ${privatePath}. Not overwriting it — keys issued with it would stop working.`);
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
mkdirSync(dirname(privatePath), { recursive: true, mode: 0o700 });
writeFileSync(privatePath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
writeFileSync(publicPath, publicKey.export({ type: "spki", format: "pem" }));
console.log(`Private key: ${privatePath}  (keep secret, back it up)`);
console.log(`Public key:  ${publicPath}  (commit this)`);
