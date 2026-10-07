// Brings the whole local stack up in order, and down again.

const fs = require("node:fs");
const path = require("node:path");
const paths = require("./paths");
const { PORTS, HOST, installConfig, buildSecrets } = require("./config");
const database = require("./database");
const services = require("./services");
const license = require("./license");
const { startGateway } = require("./gateway");
const { startNext, stopNext } = require("./nextapp");
const { startCron } = require("./cron");

let gateway = null;
let stopCron = null;
let up = false;

const databaseExists = () => fs.existsSync(path.join(paths.pgData, "PG_VERSION"));

/** The database's copy of the trial record: string, or null when it has none. */
async function readDbLicense(config) {
  return database.withClient(config, async (db) => {
    const { rows } = await db.query("select state from desktop.license where id = 1");
    return rows[0]?.state ?? null;
  });
}

async function writeDbLicense(config) {
  const sealed = license.sealedState();
  if (!sealed) return;
  await database.withClient(config, (db) =>
    db.query(
      `insert into desktop.license (id, state) values (1, $1)
       on conflict (id) do update set state = excluded.state, updated_at = now()`,
      [sealed],
    ));
}

/**
 * Starts everything. Resolves to { license } — when the database's own trial
 * record ends the demo, it stops again and resolves with that verdict
 * instead of opening the app.
 */
async function bootStack({ onStatus, onCrash }) {
  const config = installConfig();
  const secrets = buildSecrets();

  onStatus("Starting the database");
  const databaseIsNew = await database.initCluster(config);
  await database.start();
  up = true;
  await database.ensureRoles(config);

  onStatus("Preparing the database");
  await services.migrateGotrue(config, secrets);
  await database.migrate(config, onStatus);

  const verdict = await license.evaluate({ dbRecord: await readDbLicense(config), databaseIsNew });
  await writeDbLicense(config);
  if (verdict.status === "expired") {
    await stopStack();
    return { license: verdict };
  }

  onStatus("Starting services");
  await services.startGotrue(config, secrets, onCrash("Sign-in service"));
  await services.startPostgrest(config, secrets, onCrash("Database API"));
  gateway = await startGateway(config, secrets);

  onStatus("Starting the application");
  await startNext(config, secrets, onCrash("Application"));
  stopCron = startCron(config.cronSecret);
  return { license: verdict, config, secrets };
}

/** Re-checks the licence while running, keeping the database copy current. */
async function recheckLicense() {
  const config = installConfig();
  const verdict = await license.evaluate({ dbRecord: await readDbLicense(config) });
  await writeDbLicense(config);
  return verdict;
}

async function stopStack() {
  if (!up) return;
  up = false;
  stopCron?.();
  stopCron = null;
  await stopNext();
  await gateway?.close();
  gateway = null;
  await services.stopAll();
  await database.stop();
}

/** Whether any of our ports is taken by something else before we start. */
async function busyPorts() {
  const { portOpen } = require("./processes");
  const busy = [];
  for (const [name, port] of Object.entries(PORTS)) {
    if (name === "postgres") continue; // may be our own, left running
    if (await portOpen(port, HOST)) busy.push(port);
  }
  return busy;
}

/** The number of sign-in accounts; zero means the administrator is still to be created. */
async function userCount() {
  return database.withClient(installConfig(), async (db) => {
    const { rows } = await db.query("select count(*)::int as n from auth.users");
    return rows[0].n;
  });
}

module.exports = { bootStack, stopStack, recheckLicense, busyPorts, userCount, databaseExists };
