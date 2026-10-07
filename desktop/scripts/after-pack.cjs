// electron-builder hook: copies the Next standalone server into the packaged
// resources folder. extraResources cannot do it — electron-builder always
// drops node_modules folders from those, and the server needs its own.

const fs = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  const resources =
    context.electronPlatformName === "darwin"
      ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources")
      : path.join(context.appOutDir, "resources");
  const from = path.join(__dirname, "..", ".stage", "app");
  const to = path.join(resources, "app");
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, {
    recursive: true,
    filter: (src) => !src.startsWith(path.join(from, ".next", "cache")),
  });
};
