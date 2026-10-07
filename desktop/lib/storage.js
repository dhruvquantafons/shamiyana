// A small stand-in for Supabase Storage, covering exactly what the app calls
// through supabase-js: upload, remove, createSignedUrl(s), getPublicUrl.
//
// Files live on disk under <data>/storage/<bucket>/<object id>. Every
// operation first writes or reads the storage.objects row *as the caller*
// (role and JWT claims set for the transaction), so the app's own storage
// policies in supabase/migrations decide what is allowed — as they do on
// Supabase. Bucket limits come from storage.buckets.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const paths = require("./paths");

const MAX_BODY = 50 * 1024 * 1024;

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const fail = (res, status, error, message) =>
  json(res, status, { statusCode: String(status), error, message });

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error("Payload too large"), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** HS256 verification of a Supabase JWT; returns its claims or null. */
function verifyJwt(token, secret) {
  const parts = token?.split(".");
  if (parts?.length !== 3) return null;
  const expected = crypto.createHmac("sha256", secret).update(`${parts[0]}.${parts[1]}`).digest();
  const given = Buffer.from(parts[2], "base64url");
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
  if (claims.exp && claims.exp * 1000 < Date.now()) return null;
  return claims;
}

/** Object names as supabase-js sends them; nothing that could leave the bucket. */
function objectName(segments) {
  const name = segments.map(decodeURIComponent).join("/");
  if (!name || name.split("/").some((s) => s === "" || s === "." || s === "..") || name.includes("\\")) return null;
  return name;
}

function mimeAllowed(allowed, type) {
  if (!allowed?.length) return true;
  return allowed.some((a) => a === type || (a.endsWith("/*") && type.startsWith(a.slice(0, -1))));
}

function createStorage({ pool, jwtSecret, signingKey }) {
  const fileOf = (bucket, id) => path.join(paths.storage, bucket, id);

  const sign = (bucket, name, expiresIn) => {
    const exp = Math.floor(Date.now() / 1000) + Math.max(1, Number(expiresIn) || 60);
    const mac = crypto.createHmac("sha256", signingKey).update(`${bucket}/${name}:${exp}`).digest("base64url");
    return `/object/sign/${bucket}/${name.split("/").map(encodeURIComponent).join("/")}?token=${exp}.${mac}`;
  };

  const tokenValid = (bucket, name, token) => {
    const [exp, mac] = String(token ?? "").split(".");
    if (!exp || !mac || Number(exp) * 1000 < Date.now()) return false;
    const expected = crypto.createHmac("sha256", signingKey).update(`${bucket}/${name}:${exp}`).digest("base64url");
    return mac.length === expected.length && crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
  };

  /** Runs `fn` in a transaction as the caller, so RLS applies. */
  async function asCaller(claims, fn) {
    const db = await pool.connect();
    try {
      await db.query("begin");
      const role = ["anon", "authenticated", "service_role"].includes(claims.role) ? claims.role : "anon";
      await db.query(`set local role ${role}`);
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      const result = await fn(db);
      await db.query("commit");
      return result;
    } catch (err) {
      await db.query("rollback").catch(() => {});
      throw err;
    } finally {
      db.release();
    }
  }

  async function bucketInfo(bucket) {
    const { rows } = await pool.query("select * from storage.buckets where id = $1", [bucket]);
    return rows[0];
  }

  async function upload(req, res, claims, bucket, name) {
    const info = await bucketInfo(bucket);
    if (!info) return fail(res, 404, "Bucket not found", "Bucket not found");
    const raw = await readBody(req);
    let body = raw;
    let type = req.headers["content-type"] ?? "application/octet-stream";
    if (type.startsWith("multipart/form-data")) {
      const form = await new Request("http://local", { method: "POST", headers: { "content-type": type }, body: raw }).formData();
      const file = [...form.values()].find((v) => typeof v === "object");
      if (!file) return fail(res, 400, "Bad Request", "No file in the upload");
      body = Buffer.from(await file.arrayBuffer());
      type = file.type || "application/octet-stream";
    }
    type = type.split(";")[0].trim();
    if (info.file_size_limit && body.length > Number(info.file_size_limit)) {
      return fail(res, 413, "Payload too large", "The object exceeded the maximum allowed size");
    }
    if (!mimeAllowed(info.allowed_mime_types, type)) {
      return fail(res, 415, "invalid_mime_type", `mime type ${type} is not supported`);
    }
    const upsert = req.method === "PUT" || req.headers["x-upsert"] === "true";
    try {
      const row = await asCaller(claims, async (db) => {
        const metadata = { mimetype: type, size: body.length };
        const sql = upsert
          ? `insert into storage.objects (bucket_id, name, owner, metadata) values ($1, $2, $3, $4)
             on conflict (bucket_id, name) do update set metadata = excluded.metadata, updated_at = now()
             returning id`
          : `insert into storage.objects (bucket_id, name, owner, metadata) values ($1, $2, $3, $4) returning id`;
        const { rows } = await db.query(sql, [bucket, name, claims.sub ?? null, metadata]);
        const file = fileOf(bucket, rows[0].id);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, body);
        return rows[0];
      });
      json(res, 200, { Id: row.id, Key: `${bucket}/${name}` });
    } catch (err) {
      if (err.code === "23505") return fail(res, 409, "Duplicate", "The resource already exists");
      if (err.code === "42501") return fail(res, 403, "Unauthorized", "new row violates row-level security policy");
      throw err;
    }
  }

  async function remove(req, res, claims, bucket) {
    const { prefixes } = JSON.parse((await readBody(req)).toString() || "{}");
    if (!Array.isArray(prefixes)) return fail(res, 400, "Bad Request", "prefixes is required");
    const rows = await asCaller(claims, async (db) => {
      const result = await db.query(
        "delete from storage.objects where bucket_id = $1 and name = any($2) returning *",
        [bucket, prefixes],
      );
      return result.rows;
    });
    for (const row of rows) fs.rmSync(fileOf(bucket, row.id), { force: true });
    json(res, 200, rows.map((r) => ({ bucket_id: r.bucket_id, name: r.name, id: r.id, metadata: r.metadata })));
  }

  /** The objects among `names` the caller may read. */
  const readable = (claims, bucket, names) =>
    asCaller(claims, async (db) => {
      const { rows } = await db.query(
        "select name from storage.objects where bucket_id = $1 and name = any($2)",
        [bucket, names],
      );
      return new Set(rows.map((r) => r.name));
    });

  async function signOne(req, res, claims, bucket, name) {
    const { expiresIn } = JSON.parse((await readBody(req)).toString() || "{}");
    const ok = await readable(claims, bucket, [name]);
    if (!ok.has(name)) return fail(res, 400, "not_found", "Object not found");
    json(res, 200, { signedURL: sign(bucket, name, expiresIn) });
  }

  async function signMany(req, res, claims, bucket) {
    const { expiresIn, paths: names } = JSON.parse((await readBody(req)).toString() || "{}");
    if (!Array.isArray(names)) return fail(res, 400, "Bad Request", "paths is required");
    const ok = await readable(claims, bucket, names);
    json(res, 200, names.map((name) => ok.has(name)
      ? { error: null, path: name, signedURL: sign(bucket, name, expiresIn) }
      : { error: "Either the object does not exist or you do not have access to it", path: name, signedURL: null }));
  }

  async function serve(res, bucket, name, head) {
    const { rows } = await pool.query(
      "select id, metadata from storage.objects where bucket_id = $1 and name = $2",
      [bucket, name],
    );
    const file = rows[0] && fileOf(bucket, rows[0].id);
    if (!file || !fs.existsSync(file)) return fail(res, 404, "not_found", "Object not found");
    const stat = fs.statSync(file);
    res.writeHead(200, {
      "content-type": rows[0].metadata?.mimetype ?? "application/octet-stream",
      "content-length": stat.size,
      "cache-control": "max-age=3600",
    });
    if (head) return res.end();
    fs.createReadStream(file).pipe(res);
  }

  /** Handles a request whose path is below /storage/v1. */
  return async function handle(req, res, url) {
    const segments = url.pathname.split("/").filter(Boolean).slice(2); // drop "storage", "v1"
    const [kind, ...rest] = segments;
    try {
      if (kind !== "object") return fail(res, 404, "not_found", "Not found");
      const method = req.method;

      // Public bucket objects and signed URLs: no Authorization header.
      if ((method === "GET" || method === "HEAD") && (rest[0] === "public" || rest[0] === "sign")) {
        const bucket = rest[1];
        const name = objectName(rest.slice(2));
        if (!bucket || !name) return fail(res, 400, "Bad Request", "Invalid object name");
        if (rest[0] === "public") {
          const info = await bucketInfo(bucket);
          if (!info?.public) return fail(res, 400, "not_found", "Bucket not found or not public");
        } else if (!tokenValid(bucket, name, url.searchParams.get("token"))) {
          return fail(res, 400, "InvalidSignature", "The signature is invalid or has expired");
        }
        return serve(res, bucket, name, method === "HEAD");
      }

      const auth = req.headers.authorization?.replace(/^Bearer\s+/i, "");
      const claims = verifyJwt(auth, jwtSecret);
      if (!claims) return fail(res, 400, "Unauthorized", "Invalid JWT");

      if (method === "POST" && rest[0] === "sign") {
        const bucket = rest[1];
        if (rest.length === 2) return await signMany(req, res, claims, bucket);
        const name = objectName(rest.slice(2));
        if (!name) return fail(res, 400, "Bad Request", "Invalid object name");
        return await signOne(req, res, claims, bucket, name);
      }
      if (method === "DELETE" && rest.length === 1) return await remove(req, res, claims, rest[0]);
      if ((method === "POST" || method === "PUT") && rest.length >= 2) {
        const name = objectName(rest.slice(1));
        if (!name) return fail(res, 400, "Bad Request", "Invalid object name");
        return await upload(req, res, claims, rest[0], name);
      }
      return fail(res, 404, "not_found", `${method} ${url.pathname} is not supported by the desktop demo`);
    } catch (err) {
      fail(res, err.status ?? 500, "internal", err.message);
    }
  };
}

module.exports = { createStorage, verifyJwt };
