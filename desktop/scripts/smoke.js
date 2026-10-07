// End-to-end check of the staged stack, without the window: boots
// everything into a throwaway data folder, exercises auth, the database API,
// storage (with the app's own RLS policies) and the Next server through the
// same supabase-js the app uses, then shuts down.
//
//   ELECTRON_RUN_AS_NODE=1 npx electron scripts/smoke.js     (or plain `node`)
//
// Leaves the registry and real trial records alone (SHAMIYANA_LICENSE_DIR).

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "shamiyana-smoke-"));
process.env.SHAMIYANA_DATA = path.join(tmp, "data");
process.env.SHAMIYANA_LICENSE_DIR = path.join(tmp, "license");

const { createClient } = require(path.join(__dirname, "..", "..", "node_modules", "@supabase", "supabase-js"));
const stack = require("../lib/stack");
const license = require("../lib/license");
const { GATEWAY_URL, APP_URL, PORTS, HOST, buildSecrets } = require("../lib/config");

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

// A 1×1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

async function main() {
  const pre = await license.evaluate({ databaseExists: stack.databaseExists() });
  check("fresh install starts a 10-day trial", pre.status === "trial" && pre.daysLeft === 10, pre.status);

  const t0 = Date.now();
  const booted = await stack.bootStack({
    onStatus: (s) => console.log(`      ${s}`),
    onCrash: (name) => (code) => console.error(`${name} exited (${code})`),
  });
  check("stack boots", booted.license.status === "trial", `${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const secrets = buildSecrets();
  const email = "admin@demo.local";
  const password = "Demo!Passw0rd";

  const created = await fetch(`http://${HOST}:${PORTS.gotrue}/admin/users`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${secrets.serviceRoleKey}` },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: "Demo Admin" } }),
  });
  check("administrator created through Supabase Auth", created.ok, String(created.status));
  check("user count is 1", (await stack.userCount()) === 1);

  const supabase = createClient(GATEWAY_URL, secrets.anonKey, { auth: { persistSession: false } });
  const { data: signIn, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  check("password sign-in through the gateway", !signInError && !!signIn.session, signInError?.message);

  const { data: me, error: meError } = await supabase.auth.getUser();
  check("auth.getUser()", !meError && me.user?.email === email, meError?.message);

  const { data: staff, error: staffError } = await supabase.from("staff").select("role, full_name").eq("id", me.user.id).single();
  check("first user is admin (0001_init trigger, RLS as the user)", !staffError && staff?.role === "admin", staffError?.message ?? staff?.role);

  const anon = createClient(GATEWAY_URL, secrets.anonKey, { auth: { persistSession: false } });
  const { data: anonStaff } = await anon.from("staff").select("id");
  check("RLS hides staff from anonymous callers", Array.isArray(anonStaff) && anonStaff.length === 0, JSON.stringify(anonStaff));

  const { data: props, error: propsError } = await supabase.from("properties").select("id, name").limit(5);
  check("seeded properties readable", !propsError && props.length > 0, propsError?.message ?? `${props?.length} rows`);

  const { error: factorsError } = await supabase.auth.mfa.listFactors();
  check("MFA endpoints answer", !factorsError, factorsError?.message);

  // Storage: public room photo.
  const photoPath = `smoke/${Date.now()}.png`;
  const up = await supabase.storage.from("room-photos").upload(photoPath, new Blob([PNG], { type: "image/png" }), { contentType: "image/png" });
  check("upload to room-photos (File/Blob → multipart)", !up.error, up.error?.message);
  const { data: pub } = supabase.storage.from("room-photos").getPublicUrl(photoPath);
  const pubRes = await fetch(pub.publicUrl);
  check("public URL serves the photo", pubRes.status === 200 && pubRes.headers.get("content-type") === "image/png", String(pubRes.status));
  const optimised = await fetch(`${APP_URL}/_next/image?url=${encodeURIComponent(pub.publicUrl)}&w=64&q=75`);
  check("next/image optimises a local photo", optimised.status === 200, String(optimised.status));

  // Storage: private guest document, raw-body upload as frontdesk-actions does.
  const docPath = `smoke/${Date.now()}.png`;
  const docUp = await supabase.storage.from("guest-documents").upload(docPath, PNG, { contentType: "image/png", upsert: false });
  check("upload to guest-documents (Buffer → raw body)", !docUp.error, docUp.error?.message);
  const dup = await supabase.storage.from("guest-documents").upload(docPath, PNG, { contentType: "image/png", upsert: false });
  check("duplicate upload refused", !!dup.error);
  const badType = await supabase.storage.from("guest-documents").upload(`smoke/x.txt`, Buffer.from("hi"), { contentType: "text/plain" });
  check("disallowed mime type refused", !!badType.error);
  const privateGet = await fetch(`${GATEWAY_URL}/storage/v1/object/public/guest-documents/${docPath}`);
  check("private bucket has no public URL", privateGet.status >= 400, String(privateGet.status));

  const { data: signed, error: signError } = await supabase.storage.from("guest-documents").createSignedUrl(docPath, 60);
  check("createSignedUrl", !signError && !!signed?.signedUrl, signError?.message);
  const signedRes = await fetch(signed.signedUrl);
  check("signed URL serves the file", signedRes.status === 200, String(signedRes.status));
  const forged = await fetch(signed.signedUrl.replace(/token=[^&]+/, "token=9999999999.forged"));
  check("forged signature refused", forged.status >= 400, String(forged.status));

  const { data: many } = await supabase.storage.from("guest-documents").createSignedUrls([docPath, "smoke/missing.png"], 60);
  check("createSignedUrls (one present, one missing)", many?.[0]?.signedUrl && !many?.[1]?.signedUrl);

  const anonSign = await anon.storage.from("guest-documents").createSignedUrl(docPath, 60);
  check("anonymous caller cannot sign a guest document (RLS)", !!anonSign.error);
  const anonUp = await anon.storage.from("room-photos").upload(`smoke/anon.png`, PNG, { contentType: "image/png" });
  check("anonymous caller cannot upload (RLS)", !!anonUp.error);

  const removed = await supabase.storage.from("guest-documents").remove([docPath]);
  check("remove", !removed.error && removed.data?.length === 1, removed.error?.message);
  const afterRemove = await fetch(signed.signedUrl);
  check("removed file is gone", afterRemove.status === 404, String(afterRemove.status));

  // The app itself.
  const home = await fetch(`${APP_URL}/`);
  check("website home page", home.status === 200, String(home.status));
  const login = await fetch(`${APP_URL}/admin/login`);
  check("admin login page", login.status === 200, String(login.status));
  const rooms = await fetch(`${APP_URL}/rooms`);
  check("rooms page", rooms.status === 200, String(rooms.status));

  const cfg = JSON.parse(fs.readFileSync(path.join(process.env.SHAMIYANA_DATA, "config.json"), "utf8"));
  const cron = await fetch(`${APP_URL}/api/cron/maintenance`, { headers: { authorization: `Bearer ${cfg.cronSecret}` } });
  check("cron job runs with the install's secret", cron.status === 200, String(cron.status));
  const cronBad = await fetch(`${APP_URL}/api/cron/maintenance`, { headers: { authorization: "Bearer nope" } });
  check("cron job refuses a wrong secret", cronBad.status === 401, String(cronBad.status));

  const recheck = await stack.recheckLicense();
  check("licence re-check while running", recheck.status === "trial", recheck.status);
}

main()
  .catch((err) => {
    check("unexpected error", false, err.stack);
  })
  .finally(async () => {
    await stack.stopStack();
    const failed = checks.filter((c) => !c.ok).length;
    // CI throws the machine away: show the end of every log here.
    if (failed) {
      const logs = path.join(process.env.SHAMIYANA_DATA, "logs");
      for (const file of fs.existsSync(logs) ? fs.readdirSync(logs) : []) {
        const text = fs.readFileSync(path.join(logs, file), "utf8");
        console.log(`\n──── ${file} (last 60 lines) ────\n${text.split(/\r?\n/).slice(-60).join("\n")}`);
      }
    }
    console.log(`\n${checks.length - failed}/${checks.length} checks passed. Logs: ${path.join(process.env.SHAMIYANA_DATA, "logs")}`);
    process.exit(failed ? 1 : 0);
  });
