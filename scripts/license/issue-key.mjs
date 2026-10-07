#!/usr/bin/env node
// Issues an activation key for one computer running the desktop demo.
//
//   node scripts/license/issue-key.mjs --machine 7F3K-92QD-LX8M-W4TA --until 2026-12-31 --customer "Hotel X"
//   node scripts/license/issue-key.mjs --machine 7F3K-92QD-LX8M-W4TA --permanent --customer "Hotel X"
//
// The client reads the Machine ID off the "demo has ended" screen. The key
// works only on that computer, and only until the end of the --until day
// (the computer's local time).

import { sign, createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    machine: { type: "string" },
    until: { type: "string" },
    permanent: { type: "boolean", default: false },
    customer: { type: "string", default: "" },
  },
});

const machine = values.machine?.trim().toUpperCase();
if (!machine || !/^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/.test(machine)) {
  console.error("--machine must be the Machine ID shown by the app, e.g. 7F3K-92QD-LX8M-W4TA");
  process.exit(1);
}
if (values.permanent === Boolean(values.until)) {
  console.error("Give exactly one of --until YYYY-MM-DD or --permanent.");
  process.exit(1);
}
if (values.until && (!/^\d{4}-\d{2}-\d{2}$/.test(values.until) || Number.isNaN(Date.parse(values.until)))) {
  console.error("--until must be a date like 2026-12-31.");
  process.exit(1);
}

const privatePath = process.env.SHAMIYANA_LICENSE_KEY || join(homedir(), ".shamiyana-license", "private.pem");
const privateKey = createPrivateKey(readFileSync(privatePath, "utf8"));

const payload = { m: machine, e: values.until ?? null, c: values.customer, i: new Date().toISOString().slice(0, 10) };
const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
const signature = sign(null, Buffer.from(body), privateKey).toString("base64url");

console.log(`SHAM1.${body}.${signature}`);
console.error(`\nFor ${machine}${values.customer ? ` (${values.customer})` : ""}, ${values.until ? `valid until ${values.until}` : "no expiry"}.`);
