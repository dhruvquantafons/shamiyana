// The 10-day demo and the activation keys that end it.
//
// Trial state ({ start, lastSeen }) is kept in three places, each sealed with
// an HMAC bound to this machine: the registry (a hidden file on macOS), a file
// under ProgramData, and a row in the database. The uninstaller removes none
// of them, so reinstalling does not restart the trial; deleting one copy only
// leaves the others; a copy that fails its seal, a clock moved backwards, or a
// database with no trial record all end the demo.
//
// Activation keys are signed with QuantaFONS's Ed25519 private key (see
// scripts/license/issue-key.mjs) and name the Machine ID they are for, so
// they cannot be forged or moved to another computer. Only the public key
// ships with the app.

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const paths = require("./paths");

const TRIAL_DAYS = 10;
const DAY = 24 * 60 * 60 * 1000;
const CLOCK_TOLERANCE = 60 * 60 * 1000;
const PUBLIC_KEY = fs.readFileSync(path.join(__dirname, "..", "license-public.pem"), "utf8");
const SEAL_PEPPER = "qf-shamiyana-demo-v1";

const REG_KEY = "HKCU\\Software\\QuantaFONS\\Shamiyana";
const programDataFile = paths.isWindows
  ? path.join(process.env.ProgramData || "C:\\ProgramData", "QuantaFONS", "shamiyana.dat")
  : path.join(os.homedir(), "Library", "Application Support", ".qf", "shamiyana.dat");
const shadowFile = path.join(os.homedir(), paths.isWindows ? "AppData\\Local\\.qfsh" : ".qfsh");

// ── Machine ID ─────────────────────────────────────────────────────────────

function rawMachineGuid() {
  if (paths.isWindows) {
    const out = execFileSync("reg", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"], {
      encoding: "utf8",
      windowsHide: true,
    });
    return out.match(/MachineGuid\s+REG_SZ\s+(\S+)/)[1];
  }
  if (process.platform === "darwin") {
    const out = execFileSync("ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], { encoding: "utf8" });
    return out.match(/"IOPlatformUUID" = "([^"]+)"/)[1];
  }
  return fs.readFileSync("/etc/machine-id", "utf8").trim();
}

const B32 = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
let cachedMachineId;

/** e.g. "7F3K-92QD-LX8M-W4TA": what the client reads out to QuantaFONS. */
function machineId() {
  if (cachedMachineId) return cachedMachineId;
  const digest = crypto.createHash("sha256").update(`shamiyana:${rawMachineGuid().toLowerCase()}`).digest();
  let id = "";
  for (let i = 0; i < 16; i++) id += B32[digest[i] % 32];
  cachedMachineId = id.match(/.{4}/g).join("-");
  return cachedMachineId;
}

// ── Sealed trial records ───────────────────────────────────────────────────

const sealKey = () => crypto.createHash("sha256").update(`${SEAL_PEPPER}:${machineId()}`).digest();

function seal(state) {
  const body = Buffer.from(JSON.stringify(state)).toString("base64url");
  const mac = crypto.createHmac("sha256", sealKey()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

/** The state, null when absent, or "tampered" when the seal is broken. */
function unseal(text) {
  if (!text) return null;
  const [body, mac] = text.trim().split(".");
  const expected = crypto.createHmac("sha256", sealKey()).update(body ?? "").digest("base64url");
  if (!mac || mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) {
    return "tampered";
  }
  return JSON.parse(Buffer.from(body, "base64url").toString());
}

const fileStore = (file) => ({
  read: () => {
    try {
      return fs.readFileSync(file, "utf8");
    } catch {
      return null;
    }
  },
  write: (text) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  },
});

const registryStore = {
  read: () => {
    try {
      const out = execFileSync("reg", ["query", REG_KEY, "/v", "State"], { encoding: "utf8", windowsHide: true });
      return out.match(/State\s+REG_SZ\s+(\S+)/)?.[1] ?? null;
    } catch {
      return null;
    }
  },
  write: (text) => {
    execFileSync("reg", ["add", REG_KEY, "/v", "State", "/t", "REG_SZ", "/d", text, "/f"], { windowsHide: true });
  },
};

// SHAMIYANA_LICENSE_DIR keeps tests (scripts/smoke.js) away from the real records.
const testDir = process.env.SHAMIYANA_LICENSE_DIR;
const stores = testDir
  ? [fileStore(path.join(testDir, "a.dat")), fileStore(path.join(testDir, "b.dat"))]
  : [paths.isWindows ? registryStore : fileStore(shadowFile), fileStore(programDataFile)];

function readStores() {
  return stores.map((s) => unseal(s.read()));
}

function writeStores(state) {
  const text = seal(state);
  for (const s of stores) {
    try {
      s.write(text);
    } catch {
      // A store that cannot be written (permissions) is simply not used.
    }
  }
}

/** Merges copies: the earliest start, the latest lastSeen, any key. */
function merge(records) {
  const valid = records.filter((r) => r && r !== "tampered");
  if (!valid.length) return null;
  return {
    start: Math.min(...valid.map((r) => r.start)),
    lastSeen: Math.max(...valid.map((r) => r.lastSeen ?? r.start)),
    key: valid.find((r) => r.key)?.key ?? null,
  };
}

// ── Activation keys ────────────────────────────────────────────────────────

/**
 * "SHAM1.<payload>.<signature>"; payload { m: machine id, e: "YYYY-MM-DD"
 * expiry or null for no expiry, c: customer, i: issued at }.
 */
function parseKey(key) {
  const [prefix, body, sig] = String(key ?? "").trim().replace(/\s+/g, "").split(".");
  if (prefix !== "SHAM1" || !body || !sig) return { ok: false, reason: "This is not a valid activation key." };
  let valid = false;
  try {
    valid = crypto.verify(null, Buffer.from(body), PUBLIC_KEY, Buffer.from(sig, "base64url"));
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: "This is not a valid activation key." };
  const payload = JSON.parse(Buffer.from(body, "base64url").toString());
  if (payload.m !== machineId()) return { ok: false, reason: "This key was issued for a different computer." };
  const expires = payload.e ? new Date(`${payload.e}T23:59:59`).getTime() : null;
  return { ok: true, payload, expires };
}

// ── Time ───────────────────────────────────────────────────────────────────

/** Local time, unless an online clock says it is more than a day off. */
async function trustedNow() {
  const local = Date.now();
  try {
    const res = await fetch("https://www.google.com/generate_204", { method: "HEAD", signal: AbortSignal.timeout(4000) });
    const remote = Date.parse(res.headers.get("date"));
    if (Number.isFinite(remote) && Math.abs(remote - local) > DAY) return remote;
  } catch {
    // offline: local clock, guarded by lastSeen
  }
  return local;
}

// ── Evaluation ─────────────────────────────────────────────────────────────

let current = null;

/**
 * { status: "trial" | "licensed" | "expired", daysLeft, expiresAt, reason }.
 *
 * Before the database runs, call with `{ databaseExists }`; once it runs,
 * with `{ dbRecord, databaseIsNew }`, where `dbRecord` is its sealed copy or
 * null when it has none.
 */
async function evaluate({ databaseExists = false, dbRecord, databaseIsNew = false } = {}) {
  const now = await trustedNow();
  const records = readStores();
  if (dbRecord !== undefined) records.push(unseal(dbRecord));
  let state = merge(records);

  // A key from QuantaFONS settles it either way, and repairs the records.
  const key = state?.key ? parseKey(state.key) : null;
  if (key?.ok && (key.expires === null || key.expires > now)) {
    state.lastSeen = Math.max(state.lastSeen, now);
    writeStores(state);
    current = { status: "licensed", expiresAt: key.expires, customer: key.payload.c, state };
    return current;
  }

  const expired = (reason) => {
    current = { status: "expired", reason, state };
    return current;
  };

  if (!state) {
    const ranBefore = dbRecord === undefined ? databaseExists : dbRecord === null && !databaseIsNew;
    if (ranBefore) return expired("The demo records on this computer are missing.");
    state = { start: now, lastSeen: now, key: null };
  }
  if (records.includes("tampered")) return expired("The demo records on this computer have been altered.");
  if (now < state.lastSeen - CLOCK_TOLERANCE) return expired("The computer's clock has been set back.");
  if (key && !key.ok) return expired(key.reason);

  state.lastSeen = Math.max(state.lastSeen, now);
  writeStores(state);

  const trialEnds = state.start + TRIAL_DAYS * DAY;
  if (key?.ok) return expired("The activation period has ended.");
  if (now >= trialEnds) return expired(`The ${TRIAL_DAYS}-day demo has ended.`);
  current = { status: "trial", expiresAt: trialEnds, daysLeft: Math.ceil((trialEnds - now) / DAY), state };
  return current;
}

/** Stores a key after checking it; returns { ok, reason } for the activation screen. */
async function activate(key) {
  const parsed = parseKey(key);
  if (!parsed.ok) return parsed;
  const now = await trustedNow();
  if (parsed.expires !== null && parsed.expires <= now) return { ok: false, reason: "This key has already expired." };
  const state = merge(readStores()) ?? current?.state ?? { start: now, lastSeen: now };
  state.key = String(key).trim().replace(/\s+/g, "");
  state.lastSeen = Math.max(state.lastSeen ?? now, now);
  writeStores(state);
  return { ok: true };
}

/** The sealed record for the database copy. */
const sealedState = () => (current?.state ? seal(current.state) : null);

module.exports = { evaluate, activate, machineId, sealedState, TRIAL_DAYS };
