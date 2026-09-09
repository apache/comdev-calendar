/**
 * Copies Swagger UI out of node_modules and into public/vendor.
 *
 * It is vendored as a plain static asset rather than imported, for two
 * reasons. It keeps 1.5MB of third-party JavaScript out of the app bundle and
 * its source map, and - since frontend/dist is committed to the repository -
 * it means these files only change when Swagger UI is upgraded, rather than
 * being rewritten by every UI change.
 *
 * Run automatically before `npm run dev` and `npm run build`.
 */

import { createRequire } from "node:module";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const source = dirname(require.resolve("swagger-ui-dist/package.json"));
const version = require("swagger-ui-dist/package.json").version;
const target = new URL("../public/vendor/", import.meta.url).pathname;

const FILES = ["swagger-ui-bundle.js", "swagger-ui.css", "swagger-ui-bundle.js.LICENSE.txt"];

await mkdir(target, { recursive: true });
for (const name of FILES) {
  await copyFile(join(source, name), join(target, name));
}
await writeFile(
  join(target, "VERSION"),
  `swagger-ui-dist ${version}\nCopied from node_modules by scripts/vendor-swagger.mjs; do not edit.\n`,
);

console.log(`Vendored swagger-ui-dist ${version} into public/vendor/`);
