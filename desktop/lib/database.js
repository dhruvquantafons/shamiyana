// The bundled PostgreSQL: create the cluster on first start, start and stop
// it, and bring the schema up to date.
//
// pg_ctl and initdb are used rather than running postgres directly: on
// Windows postgres refuses to run as an administrator, and these two drop to
// a restricted token on their own.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Client } = require("pg");
const paths = require("./paths");
const { PORTS, HOST, dbUrl } = require("./config");
const { run, waitFor, portOpen } = require("./processes");

const env = () => ({
  ...process.env,
  // Postgres's own DLLs/dylibs, for initdb, pg_ctl and PostgREST alike.
  PATH: [path.dirname(paths.pgBin("postgres")), process.env.PATH].join(path.delimiter),
  ...(process.platform === "darwin" ? { DYLD_LIBRARY_PATH: paths.pgLib } : {}),
});

async function initCluster(config) {
  if (fs.existsSync(path.join(paths.pgData, "PG_VERSION"))) return false;
  fs.mkdirSync(paths.data, { recursive: true });
  const pwfile = path.join(os.tmpdir(), `shamiyana-${process.pid}.pw`);
  fs.writeFileSync(pwfile, config.postgresPassword, { mode: 0o600 });
  try {
    await run("initdb", paths.pgBin("initdb"), [
      "-D", paths.pgData,
      "-U", "postgres",
      `--pwfile=${pwfile}`,
      "--auth=scram-sha-256",
      "-E", "UTF8",
      "--no-locale",
    ], { env: env() });
  } finally {
    fs.rmSync(pwfile, { force: true });
  }
  fs.appendFileSync(
    path.join(paths.pgData, "postgresql.conf"),
    [
      "",
      "# Shamiyana desktop demo",
      `listen_addresses = '${HOST}'`,
      `port = ${PORTS.postgres}`,
      "unix_socket_directories = ''",
      "max_connections = 50",
      "",
    ].join("\n"),
  );
  return true;
}

async function start() {
  if (await portOpen(PORTS.postgres)) {
    // Left running by a previous session that did not shut down cleanly.
    const status = await run("pg_ctl", paths.pgBin("pg_ctl"), ["status", "-D", paths.pgData], { env: env() }).catch(() => null);
    if (status) return;
    throw new Error(`Port ${PORTS.postgres} is already in use by another program.`);
  }
  await run("pg_ctl", paths.pgBin("pg_ctl"), [
    "start", "-w", "-t", "60",
    "-D", paths.pgData,
    "-l", path.join(paths.logs, "postgres.log"),
  ], { env: env() });
  await waitFor("PostgreSQL", () => portOpen(PORTS.postgres));
}

function stop() {
  return run("pg_ctl", paths.pgBin("pg_ctl"), ["stop", "-m", "fast", "-w", "-D", paths.pgData], { env: env() })
    .catch(() => {});
}

async function withClient(config, fn) {
  const client = new Client({ connectionString: dbUrl("postgres", config.postgresPassword) });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** The roles a Supabase project has, before Supabase Auth runs its own migrations. */
function ensureRoles(config) {
  return withClient(config, async (db) => {
    const lit = (s) => db.escapeLiteral(s);
    await db.query(`
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
        if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator login noinherit; end if;
        if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin login noinherit createrole; end if;
      end $$;
      alter role authenticator password ${lit(config.authenticatorPassword)};
      alter role supabase_auth_admin password ${lit(config.authAdminPassword)};
      grant anon, authenticated, service_role to authenticator;
      create schema if not exists auth authorization supabase_auth_admin;
      grant create on database postgres to supabase_auth_admin;
      alter role supabase_auth_admin set search_path = auth;
    `);
  });
}

/**
 * platform.sql, then every supabase/migrations file not yet applied, each in
 * its own transaction — the same order and atomicity as `supabase db push`
 * and supabase/tests/run.sh.
 */
function migrate(config, onProgress) {
  return withClient(config, async (db) => {
    await db.query(fs.readFileSync(paths.platformSql, "utf8"));
    const { rows } = await db.query("select name from desktop.migrations");
    const applied = new Set(rows.map((r) => r.name));
    const pending = fs.readdirSync(paths.appMigrations).filter((f) => f.endsWith(".sql") && !applied.has(f)).sort();
    for (const [i, file] of pending.entries()) {
      onProgress?.(`Preparing database (${i + 1}/${pending.length})`);
      const sql = fs.readFileSync(path.join(paths.appMigrations, file), "utf8");
      try {
        await db.query("begin");
        await db.query(sql);
        await db.query("insert into desktop.migrations (name) values ($1)", [file]);
        await db.query("commit");
      } catch (err) {
        await db.query("rollback").catch(() => {});
        throw new Error(`Migration ${file} failed: ${err.message}`);
      }
    }
    // PostgREST caches the schema; tell it about the new one.
    if (pending.length) await db.query("notify pgrst, 'reload schema'");
  });
}

module.exports = { env, initCluster, start, stop, ensureRoles, migrate, withClient };
