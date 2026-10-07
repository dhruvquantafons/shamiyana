// Supabase Auth (GoTrue) and PostgREST, configured the way Supabase's own
// self-hosted docker-compose configures them.

const { PORTS, HOST, GATEWAY_URL, APP_URL, dbUrl } = require("./config");
const paths = require("./paths");
const database = require("./database");
const { start, run, stop, waitFor, httpOk } = require("./processes");

function gotrueEnv(config, secrets) {
  const smtp = secrets.smtp ?? {};
  return {
    ...process.env,
    GOTRUE_API_HOST: HOST,
    PORT: String(PORTS.gotrue),
    API_EXTERNAL_URL: `${GATEWAY_URL}/auth/v1`,
    GOTRUE_DB_DRIVER: "postgres",
    DATABASE_URL: dbUrl("supabase_auth_admin", config.authAdminPassword),
    GOTRUE_DB_MIGRATIONS_PATH: paths.gotrueMigrations,
    GOTRUE_SITE_URL: APP_URL,
    GOTRUE_URI_ALLOW_LIST: `${APP_URL}/**`,
    GOTRUE_DISABLE_SIGNUP: "false",
    GOTRUE_JWT_SECRET: secrets.jwtSecret,
    GOTRUE_JWT_EXP: "3600",
    GOTRUE_JWT_AUD: "authenticated",
    GOTRUE_JWT_DEFAULT_GROUP_NAME: "authenticated",
    GOTRUE_JWT_ADMIN_ROLES: "service_role",
    GOTRUE_JWT_ISSUER: `${GATEWAY_URL}/auth/v1`,
    GOTRUE_EXTERNAL_EMAIL_ENABLED: "true",
    GOTRUE_EXTERNAL_PHONE_ENABLED: "false",
    // Demo: nobody has to click a confirmation email before signing in.
    GOTRUE_MAILER_AUTOCONFIRM: "true",
    GOTRUE_MFA_TOTP_ENROLL_ENABLED: "true",
    GOTRUE_MFA_TOTP_VERIFY_ENABLED: "true",
    GOTRUE_MFA_MAX_ENROLLED_FACTORS: "10",
    // Guest-portal one-time codes go out through Resend's SMTP relay when the
    // build carries a test key; otherwise GUEST_PASSWORD_LOGIN covers sign-in.
    ...(smtp.host
      ? {
          GOTRUE_SMTP_HOST: smtp.host,
          GOTRUE_SMTP_PORT: String(smtp.port),
          GOTRUE_SMTP_USER: smtp.user,
          GOTRUE_SMTP_PASS: smtp.pass,
          GOTRUE_SMTP_ADMIN_EMAIL: smtp.from,
          GOTRUE_SMTP_SENDER_NAME: "Hotel Shamiyana",
        }
      : {}),
    GOTRUE_MAILER_OTP_EXP: "600",
    GOTRUE_RATE_LIMIT_EMAIL_SENT: "100",
    GOTRUE_LOG_LEVEL: "info",
  };
}

async function startGotrue(config, secrets, onCrash) {
  start("gotrue", paths.gotrue, ["serve"], { env: gotrueEnv(config, secrets) }, onCrash);
  await waitFor("Sign-in service", httpOk(`http://${HOST}:${PORTS.gotrue}/health`), 120000);
}

/** Runs Supabase Auth's schema migrations without serving. */
function migrateGotrue(config, secrets) {
  return run("gotrue-migrate", paths.gotrue, ["migrate"], { env: gotrueEnv(config, secrets) });
}

async function startPostgrest(config, secrets, onCrash) {
  start("postgrest", paths.postgrest, [], {
    env: {
      ...database.env(),
      PGRST_DB_URI: dbUrl("authenticator", config.authenticatorPassword),
      PGRST_DB_SCHEMAS: "public",
      PGRST_DB_EXTRA_SEARCH_PATH: "public",
      PGRST_DB_ANON_ROLE: "anon",
      PGRST_DB_MAX_ROWS: "1000",
      PGRST_DB_USE_LEGACY_GUCS: "false",
      PGRST_JWT_SECRET: secrets.jwtSecret,
      PGRST_SERVER_HOST: HOST,
      PGRST_SERVER_PORT: String(PORTS.postgrest),
      PGRST_DB_CHANNEL_ENABLED: "true",
    },
  }, onCrash);
  await waitFor("Database API", httpOk(`http://${HOST}:${PORTS.postgrest}/`), 60000);
}

const stopAll = () => Promise.all([stop("postgrest"), stop("gotrue")]);

module.exports = { startGotrue, migrateGotrue, startPostgrest, stopAll };
