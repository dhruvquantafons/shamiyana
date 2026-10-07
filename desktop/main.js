// Hotel Shamiyana PMS — Windows desktop demo.
//
// One window. It shows the start-up progress, the activation screen when the
// demo has ended, the first-run administrator form, and then the app itself.
// See desktop/README.md for how the pieces fit together.

const { app, BrowserWindow, ipcMain, shell, clipboard, dialog } = require("electron");
const path = require("node:path");
const paths = require("./lib/paths");
const license = require("./lib/license");
const stack = require("./lib/stack");
const { APP_URL, PORTS, HOST, installConfig, buildSecrets } = require("./lib/config");
const contact = require("./contact.json");

const PRODUCT = "Hotel Shamiyana PMS";
const LICENSE_RECHECK = 60 * 60 * 1000;

let win = null;
let verdict = null;
let recheckTimer = null;
let quitting = false;

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

function ui(page) {
  return win.loadFile(path.join(__dirname, "ui", page));
}

function status(message) {
  win?.webContents.send("status", message);
}

function setTitle() {
  if (!win) return;
  const suffix =
    verdict?.status === "trial"
      ? ` — Demo (${verdict.daysLeft} day${verdict.daysLeft === 1 ? "" : "s"} left)`
      : verdict?.status === "licensed" ? "" : " — Demo";
  win.setTitle(PRODUCT + suffix);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: PRODUCT,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.once("ready-to-show", () => win.show());
  win.on("page-title-updated", (event) => {
    event.preventDefault();
    setTitle();
  });

  // Payment links, mailto: and other sites open in the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(APP_URL)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(APP_URL) || url.startsWith("file:")) return;
    event.preventDefault();
    shell.openExternal(url);
  });
}

async function showActivation() {
  clearInterval(recheckTimer);
  await stack.stopStack();
  setTitle();
  await ui("activate.html");
}

async function boot() {
  await ui("status.html");
  try {
    // Nothing starts — not even the database — once the demo has ended.
    verdict = await license.evaluate({ databaseExists: stack.databaseExists() });
    setTitle();
    if (verdict.status === "expired") return showActivation();

    const busy = await stack.busyPorts();
    if (busy.length) {
      throw new Error(
        `Another program is using port ${busy.join(", ")}. Close it (or restart the computer) and open ${PRODUCT} again.`,
      );
    }

    const result = await stack.bootStack({
      onStatus: status,
      onCrash: (name) => (code) => {
        if (quitting) return;
        fail(new Error(`${name} stopped unexpectedly (exit code ${code}).`));
      },
    });
    verdict = result.license;
    setTitle();
    if (verdict.status === "expired") return showActivation();

    recheckTimer = setInterval(async () => {
      try {
        verdict = await stack.recheckLicense();
        setTitle();
        if (verdict.status === "expired") await showActivation();
      } catch {
        // checked again next hour
      }
    }, LICENSE_RECHECK);

    if ((await stack.userCount()) === 0) return ui("setup.html");
    await win.loadURL(`${APP_URL}/admin`);
  } catch (err) {
    fail(err);
  }
}

async function fail(err) {
  await stack.stopStack().catch(() => {});
  if (!win) return;
  await ui("status.html");
  win.webContents.send("failed", { message: err.message, logs: paths.logs });
}

// ── Bridge for the local pages in ui/ ──────────────────────────────────────

ipcMain.handle("license:get", () => ({
  status: verdict?.status,
  reason: verdict?.reason,
  daysLeft: verdict?.daysLeft,
  machineId: license.machineId(),
  contact,
  trialDays: license.TRIAL_DAYS,
}));

ipcMain.handle("license:activate", async (_e, key) => {
  const result = await license.activate(key);
  if (result.ok) setImmediate(boot);
  return result;
});

ipcMain.handle("clipboard:write", (_e, text) => clipboard.writeText(String(text)));
ipcMain.handle("logs:open", () => shell.openPath(paths.logs));
ipcMain.handle("app:retry", () => boot());

ipcMain.handle("setup:create-admin", async (_e, { name, email, password }) => {
  if ((await stack.userCount()) !== 0) return { ok: false, reason: "An administrator already exists." };
  const secrets = buildSecrets();
  const res = await fetch(`http://${HOST}:${PORTS.gotrue}/admin/users`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${secrets.serviceRoleKey}`,
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: name ? { full_name: name } : {},
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { ok: false, reason: body.msg || body.message || `Could not create the account (${res.status}).` };
  }
  setImmediate(() => win.loadURL(`${APP_URL}/admin/login`));
  return { ok: true };
});

// ── Lifecycle ──────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  installConfig(); // first start: generate this installation's secrets
  createWindow();
  boot();
});

app.on("window-all-closed", () => app.quit());

app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  clearInterval(recheckTimer);
  stack.stopStack().catch(() => {}).finally(() => app.exit(0));
});

process.on("uncaughtException", (err) => {
  dialog.showErrorBox(PRODUCT, `${err.message}\n\nLogs: ${paths.logs}`);
});
