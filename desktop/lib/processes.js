// Starting, watching and stopping the background programs.

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const paths = require("./paths");

const running = new Map();

function logStream(name) {
  fs.mkdirSync(paths.logs, { recursive: true });
  return fs.createWriteStream(path.join(paths.logs, `${name}.log`), { flags: "a" });
}

/** Runs a program to completion, failing with the tail of its output. */
function run(name, command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const log = logStream(name);
    const child = spawn(command, args, { windowsHide: true, ...options });
    let tail = "";
    let settled = false;
    const keep = (chunk) => {
      if (settled) return;
      log.write(chunk);
      tail = (tail + chunk).slice(-4000);
    };
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);
    child.on("error", reject);
    // Settle on exit, not on "close": `pg_ctl start` hands its output handles
    // to the server it launches, so they stay open for as long as it runs.
    const settle = (code) => {
      if (settled) return;
      settled = true;
      log.end();
      child.stdout?.destroy();
      child.stderr?.destroy();
      if (code === 0) resolve(tail);
      else reject(new Error(`${name} exited with code ${code}:\n${tail}`));
    };
    child.on("close", settle);
    child.on("exit", (code) => setTimeout(() => settle(code), 250));
  });
}

/** Starts a long-running program; `onExit` hears about unexpected exits. */
function start(name, command, args, options = {}, onExit) {
  const log = logStream(name);
  const child = spawn(command, args, { windowsHide: true, ...options });
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  running.set(name, child);
  child.on("exit", (code, signal) => {
    if (running.get(name) !== child) return;
    running.delete(name);
    onExit?.(code, signal);
  });
  return child;
}

function stop(name) {
  const child = running.get(name);
  if (!child) return Promise.resolve();
  running.delete(name);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill();
  });
}

function portOpen(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

/** Waits until `check()` resolves truthy, or fails after `timeoutMs`. */
async function waitFor(what, check, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`${what} did not start within ${timeoutMs / 1000} seconds. See the logs in ${paths.logs}.`);
}

const httpOk = (url) => async () => {
  const res = await fetch(url);
  return res.status < 500;
};

module.exports = { run, start, stop, portOpen, waitFor, httpOk, running };
