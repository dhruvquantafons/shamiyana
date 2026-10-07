// Ports, build-time secrets and per-installation secrets.

const crypto = require("node:crypto");
const fs = require("node:fs");
const paths = require("./paths");

// Fixed, because NEXT_PUBLIC_SUPABASE_URL is compiled into the browser
// bundle. Everything binds to 127.0.0.1 only.
const PORTS = {
  gateway: 54321,
  postgres: 54322,
  postgrest: 54323,
  gotrue: 54324,
  next: 54330,
};

const HOST = "127.0.0.1";
const GATEWAY_URL = `http://${HOST}:${PORTS.gateway}`;
const APP_URL = `http://${HOST}:${PORTS.next}`;

/**
 * Written by scripts/build-app.mjs: the JWT secret and the anon and
 * service-role keys signed with it. The anon key is compiled into the browser
 * bundle, so these have to be fixed per build; the test-mode integration keys
 * from desktop/demo.env travel here too.
 */
function buildSecrets() {
  return JSON.parse(fs.readFileSync(paths.buildSecrets, "utf8"));
}

/**
 * Generated on first start: database passwords and signing keys that belong
 * to this installation only.
 */
function installConfig() {
  try {
    return JSON.parse(fs.readFileSync(paths.installConfig, "utf8"));
  } catch {
    const random = () => crypto.randomBytes(24).toString("base64url");
    const config = {
      postgresPassword: random(),
      authenticatorPassword: random(),
      authAdminPassword: random(),
      storageSigningKey: random(),
      cronSecret: random(),
    };
    fs.mkdirSync(paths.data, { recursive: true });
    fs.writeFileSync(paths.installConfig, JSON.stringify(config, null, 2), { mode: 0o600 });
    return config;
  }
}

const dbUrl = (user, password) =>
  `postgres://${user}:${encodeURIComponent(password)}@${HOST}:${PORTS.postgres}/postgres`;

module.exports = { PORTS, HOST, GATEWAY_URL, APP_URL, buildSecrets, installConfig, dbUrl };
