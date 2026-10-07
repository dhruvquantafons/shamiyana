// The Next.js standalone server, run on Electron's own Node.

const path = require("node:path");
const paths = require("./paths");
const { PORTS, HOST, GATEWAY_URL, APP_URL } = require("./config");
const { start, stop, waitFor, httpOk } = require("./processes");

async function startNext(config, secrets, onCrash) {
  start("next", process.execPath, [paths.nextServer], {
    cwd: path.dirname(paths.nextServer),
    env: {
      ...process.env,
      // Test-mode integration keys (Razorpay, Resend, Twilio) from demo.env.
      ...secrets.appEnv,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: String(PORTS.next),
      HOSTNAME: HOST,
      NEXT_PUBLIC_SUPABASE_URL: GATEWAY_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: secrets.anonKey,
      NEXT_PUBLIC_SITE_URL: APP_URL,
      SUPABASE_SERVICE_ROLE_KEY: secrets.serviceRoleKey,
      CRON_SECRET: config.cronSecret,
      TWO_FACTOR_MODE: "demo",
      GUEST_PASSWORD_LOGIN: "true",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  }, onCrash);
  await waitFor("Application", httpOk(`${APP_URL}/`), 120000);
}

const stopNext = () => stop("next");

module.exports = { startNext, stopNext };
