/**
 * Set a module's version and point its download URL at that version's release.
 * Usage: npm run set-version -- <module-id> <x.y.z>
 * Merging the change to main publishes the release (see .github/workflows/release.yml).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { expectedUrls, releaseProblems } from "./lib/release.mjs";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const [id, version] = process.argv.slice(2);
if ( !id || !version ) {
  console.error("Usage: npm run set-version -- <module-id> <x.y.z>");
  process.exit(1);
}

const path = join(ROOT, "modules", id, "module.json");
const manifest = JSON.parse(readFileSync(path, "utf8"));
manifest.version = version;
Object.assign(manifest, expectedUrls(manifest));
const problems = releaseProblems(manifest);
if ( problems.length ) {
  console.error(problems.join("\n"));
  process.exit(1);
}
writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`${id} is now ${version}; download: ${manifest.download}`);
