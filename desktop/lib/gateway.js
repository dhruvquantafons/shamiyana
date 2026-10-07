// The one address the app knows (NEXT_PUBLIC_SUPABASE_URL), routing the way
// Supabase's API gateway does: /auth/v1 → Supabase Auth, /rest/v1 →
// PostgREST, /storage/v1 → desktop/lib/storage.js. Realtime is not served;
// LiveRefresh polls instead in the desktop build.

const http = require("node:http");
const { Pool } = require("pg");
const { PORTS, HOST, dbUrl } = require("./config");
const { createStorage } = require("./storage");

const UPSTREAMS = {
  "/auth/v1": PORTS.gotrue,
  "/rest/v1": PORTS.postgrest,
};

// The browser client calls this port from the app's origin.
function cors(req, res) {
  res.setHeader("access-control-allow-origin", req.headers.origin ?? "*");
  res.setHeader("access-control-allow-credentials", "true");
  res.setHeader("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD");
  res.setHeader("access-control-allow-headers", req.headers["access-control-request-headers"] ?? "*");
  res.setHeader("access-control-expose-headers", "content-range, x-total-count, content-profile, x-supabase-api-version");
  res.setHeader("access-control-max-age", "3600");
}

function proxy(req, res, port, upstreamPath) {
  const headers = { ...req.headers, host: `${HOST}:${port}` };
  const upstream = http.request(
    { host: HOST, port, method: req.method, path: upstreamPath, headers },
    (up) => {
      for (const key of Object.keys(up.headers)) {
        if (key.startsWith("access-control-")) delete up.headers[key];
      }
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", (err) => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: `Service unavailable: ${err.message}` }));
  });
  req.pipe(upstream);
}

function startGateway(config, secrets) {
  const pool = new Pool({ connectionString: dbUrl("postgres", config.postgresPassword), max: 5 });
  const storage = createStorage({
    pool,
    jwtSecret: secrets.jwtSecret,
    signingKey: config.storageSigningKey,
  });

  const server = http.createServer((req, res) => {
    cors(req, res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }
    const url = new URL(req.url ?? "/", `http://${HOST}`);
    if (url.pathname.startsWith("/storage/v1/")) return storage(req, res, url);
    for (const [prefix, port] of Object.entries(UPSTREAMS)) {
      if (url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)) {
        return proxy(req, res, port, (url.pathname.slice(prefix.length) || "/") + url.search);
      }
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "no route matched" }));
  });

  return new Promise((resolve, reject) => {
    server.once("error", (err) =>
      reject(err.code === "EADDRINUSE" ? new Error(`Port ${PORTS.gateway} is already in use by another program.`) : err));
    server.listen(PORTS.gateway, HOST, () =>
      resolve({
        close: () =>
          new Promise((r) => {
            server.close(() => pool.end().then(r, r));
            server.closeAllConnections();
          }),
      }));
  });
}

module.exports = { startGateway };
