// The scheduled jobs Vercel Cron runs in production (vercel.json): each
// daily, plus straight away when the app starts after a missed day.
// Maintenance escalation also runs every 30 minutes, as its route asks.

const fs = require("node:fs");
const path = require("node:path");
const paths = require("./paths");
const { APP_URL } = require("./config");

const JOBS = [
  { name: "reports", every: 24 * 60 * 60 * 1000 },
  { name: "maintenance", every: 30 * 60 * 1000 },
  { name: "notifications", every: 24 * 60 * 60 * 1000 },
];

const stateFile = () => path.join(paths.data, "cron.json");

function load() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), "utf8"));
  } catch {
    return {};
  }
}

function startCron(cronSecret) {
  const last = load();
  const log = fs.createWriteStream(path.join(paths.logs, "cron.log"), { flags: "a" });

  async function tick() {
    for (const job of JOBS) {
      if (Date.now() - (last[job.name] ?? 0) < job.every) continue;
      last[job.name] = Date.now();
      try {
        const res = await fetch(`${APP_URL}/api/cron/${job.name}`, {
          headers: { authorization: `Bearer ${cronSecret}` },
          signal: AbortSignal.timeout(5 * 60 * 1000),
        });
        log.write(`${new Date().toISOString()} ${job.name} ${res.status}\n`);
      } catch (err) {
        log.write(`${new Date().toISOString()} ${job.name} failed: ${err.message}\n`);
      }
      fs.writeFileSync(stateFile(), JSON.stringify(last));
    }
  }

  tick();
  const timer = setInterval(tick, 5 * 60 * 1000);
  return () => {
    clearInterval(timer);
    log.end();
  };
}

module.exports = { startCron };
