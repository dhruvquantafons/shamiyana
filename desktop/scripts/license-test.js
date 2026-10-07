// Checks the trial and activation rules with a fake clock.
//
//   node scripts/license-test.js
//
// Needs the private key from scripts/license/gen-keypair.mjs to issue keys.

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shamiyana-license-"));
process.env.SHAMIYANA_LICENSE_DIR = dir;
process.env.SHAMIYANA_DATA = path.join(dir, "data");

// No network clock in tests: the fake one below is the only time there is.
global.fetch = () => Promise.reject(new Error("offline"));
const realNow = Date.now;
let offset = 0;
Date.now = () => realNow() + offset;
const DAY = 24 * 60 * 60 * 1000;

const license = require("../lib/license");
const root = path.join(__dirname, "..", "..");
const issue = (...args) =>
  execFileSync(process.execPath, [path.join(root, "scripts", "license", "issue-key.mjs"), ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  }).trim();
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

let failed = 0;
function check(name, ok, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

const reset = () => {
  for (const f of fs.readdirSync(dir)) if (f.endsWith(".dat")) fs.rmSync(path.join(dir, f));
  offset = 0;
};

(async () => {
  const id = license.machineId();
  check("machine id format", /^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/.test(id), id);

  let v = await license.evaluate({ databaseExists: false });
  check("day 0: trial, 10 days left", v.status === "trial" && v.daysLeft === 10, `${v.status} ${v.daysLeft}`);
  const firstDb = license.sealedState();

  offset = 9.5 * DAY;
  v = await license.evaluate({ dbRecord: firstDb });
  check("day 9.5: still trial, 1 day left", v.status === "trial" && v.daysLeft === 1, `${v.status} ${v.daysLeft}`);

  offset = 10 * DAY + 60000;
  v = await license.evaluate({ dbRecord: firstDb });
  check("day 10: expired", v.status === "expired", v.reason);

  offset = 5 * DAY;
  v = await license.evaluate({ dbRecord: firstDb });
  check("clock set back after expiry: still expired", v.status === "expired" && /clock/.test(v.reason), v.reason);

  offset = 10 * DAY + 120000;
  const other = await license.activate(issue("--machine", "AAAA-BBBB-CCCC-DDDD", "--permanent"));
  check("key for another machine refused", !other.ok, other.reason);
  const forged = await license.activate(`SHAM1.${Buffer.from(JSON.stringify({ m: id, e: null })).toString("base64url")}.AAAA`);
  check("forged key refused", !forged.ok, forged.reason);
  const stale = await license.activate(issue("--machine", id, "--until", isoDay(realNow() - 2 * DAY)));
  check("already-expired key refused", !stale.ok, stale.reason);

  const until = isoDay(Date.now() + 30 * DAY);
  const good = await license.activate(issue("--machine", id, "--until", until, "--customer", "Test Hotel"));
  check("valid key accepted", good.ok, good.reason);
  v = await license.evaluate({ dbRecord: license.sealedState() });
  check("licensed after activation", v.status === "licensed" && v.customer === "Test Hotel", v.status);

  offset += 31 * DAY;
  v = await license.evaluate({ dbRecord: license.sealedState() });
  check("dated key ends on its date", v.status === "expired" && /activation period/.test(v.reason), v.reason);

  const perm = await license.activate(issue("--machine", id, "--permanent"));
  v = await license.evaluate({ dbRecord: license.sealedState() });
  check("permanent key", perm.ok && v.status === "licensed" && v.expiresAt === null, v.status);

  // Reinstall / tampering, fresh trial each time.
  reset();
  await license.evaluate({ databaseExists: false });
  const db = license.sealedState();
  for (const f of fs.readdirSync(dir)) if (f.endsWith(".dat")) fs.rmSync(path.join(dir, f));
  offset = 11 * DAY;
  v = await license.evaluate({ dbRecord: db });
  check("records deleted, database copy remembers the start", v.status === "expired", v.reason);

  reset();
  await license.evaluate({ databaseExists: false });
  for (const f of fs.readdirSync(dir)) if (f.endsWith(".dat")) fs.rmSync(path.join(dir, f));
  v = await license.evaluate({ databaseExists: true });
  check("every record deleted but data left behind: expired", v.status === "expired", v.reason);

  reset();
  await license.evaluate({ databaseExists: false });
  const a = path.join(dir, "a.dat");
  const [body, mac] = fs.readFileSync(a, "utf8").split(".");
  const edited = JSON.parse(Buffer.from(body, "base64url").toString());
  edited.start += 30 * DAY;
  fs.writeFileSync(a, `${Buffer.from(JSON.stringify(edited)).toString("base64url")}.${mac}`);
  v = await license.evaluate({ databaseExists: true });
  check("edited record (start moved forward) detected", v.status === "expired" && /altered/.test(v.reason), v.reason);
  const rescue = await license.activate(issue("--machine", id, "--permanent"));
  v = await license.evaluate({ databaseExists: true });
  check("a valid key still activates a tampered machine", rescue.ok && v.status === "licensed", v.status);

  reset();
  v = await license.evaluate({ dbRecord: null, databaseIsNew: true });
  check("brand-new database: trial starts", v.status === "trial", v.status);
  reset();
  v = await license.evaluate({ dbRecord: null, databaseIsNew: false });
  check("old database without any record: expired", v.status === "expired", v.reason);

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failed ? `\n${failed} failed` : "\nAll licence checks passed.");
  process.exit(failed ? 1 : 0);
})();
