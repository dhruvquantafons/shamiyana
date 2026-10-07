// Where everything lives, packaged and in development.
//
// Packaged, electron-builder copies the staged runtime (see
// scripts/stage-runtime.mjs and stage-app.mjs) into the installation's
// resources folder. In
// development the same layout is read straight from desktop/.stage.

const os = require("node:os");
const path = require("node:path");

// Outside Electron (scripts/smoke.js, run with ELECTRON_RUN_AS_NODE) there is
// no `app`; SHAMIYANA_RESOURCES and SHAMIYANA_DATA say where things are.
const { app } = (() => {
  const electron = require("electron");
  return typeof electron === "object" ? electron : {};
})();

const isWindows = process.platform === "win32";
const exe = (name) => (isWindows ? `${name}.exe` : name);

const resources =
  process.env.SHAMIYANA_RESOURCES ||
  (app?.isPackaged ? process.resourcesPath : path.join(__dirname, "..", ".stage"));

// Per-machine data: the database, uploaded files, logs. Kept in the user's
// local (not roaming) profile, so it never syncs with a domain account.
const data =
  process.env.SHAMIYANA_DATA ||
  (isWindows
    ? path.join(process.env.LOCALAPPDATA || os.homedir(), "Shamiyana")
    : path.join(app?.getPath("userData") ?? path.join(os.homedir(), ".shamiyana"), "data"));

module.exports = {
  isWindows,
  resources,
  data,
  pgBin: (name) => path.join(resources, "pgsql", "bin", exe(name)),
  pgLib: path.join(resources, "pgsql", "lib"),
  gotrue: path.join(resources, "bin", exe("gotrue")),
  gotrueMigrations: path.join(resources, "gotrue-migrations"),
  postgrest: path.join(resources, "bin", exe("postgrest")),
  nextServer: path.join(resources, "app", "server.js"),
  appMigrations: path.join(resources, "migrations"),
  buildSecrets: path.join(resources, "build-secrets.json"),
  platformSql: path.join(__dirname, "..", "sql", "platform.sql"),
  pgData: path.join(data, "pgdata"),
  storage: path.join(data, "storage"),
  logs: path.join(data, "logs"),
  installConfig: path.join(data, "config.json"),
};
