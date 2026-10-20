/**
 * Build the release zip for every module: dist/<id>.zip with module.json at the zip root (where Foundry's installer
 * expects it), plus dist/<id>/module.json to attach next to it. Verifies each zip before reporting success.
 * Usage: node scripts/package.mjs [--out dist]
 */
import { readdirSync, readFileSync, existsSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { releaseProblems, releaseTag } from "./lib/release.mjs";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const outArg = process.argv.indexOf("--out");
const OUT = resolve(ROOT, outArg > 0 ? process.argv[outArg + 1] : "dist");

function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

try {
  execFileSync("zip", ["-v"], { stdio: "ignore" });
} catch {
  fail("the zip command is required (preinstalled on GitHub's Ubuntu runners)");
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for ( const id of readdirSync(join(ROOT, "modules")) ) {
  const dir = join(ROOT, "modules", id);
  const manifestPath = join(dir, "module.json");
  if ( !existsSync(manifestPath) ) continue;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const problems = releaseProblems(manifest);
  if ( problems.length ) fail(`${id}: ${problems.join("; ")}`);

  const zip = join(OUT, `${id}.zip`);
  execFileSync("zip", ["-r", "-X", "-q", zip, ".", "-x", ".*", "-x", "*/.*"], { cwd: dir });

  // The installer needs module.json at the root and every file the manifest references
  const entries = new Set(execFileSync("unzip", ["-Z1", zip]).toString().split("\n").filter(Boolean));
  const required = ["module.json", ...(manifest.esmodules ?? []), ...(manifest.styles ?? []),
    ...(manifest.languages ?? []).map(l => l.path)];
  for ( const file of required ) if ( !entries.has(file) ) fail(`${id}.zip is missing ${file}`);

  mkdirSync(join(OUT, id), { recursive: true });
  copyFileSync(manifestPath, join(OUT, id, "module.json"));
  console.log(`${id} ${manifest.version} -> ${zip} (${entries.size} entries, tag ${releaseTag(manifest)})`);
}
