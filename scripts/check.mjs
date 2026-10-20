/**
 * Static checks for every module in modules/: manifest sanity, JavaScript syntax, localization keys, and the
 * eager-load budget from CLAUDE.md. Run with `npm run check`.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const MODULES = join(ROOT, "modules");
const EAGER_BUDGET = { files: 10, bytes: 64 * 1024, depth: 2 };

let failures = 0;
const fail = (where, msg) => {
  failures++;
  console.error(`✖ ${where}: ${msg}`);
};

function walk(dir, out = []) {
  for ( const name of readdirSync(dir) ) {
    const p = join(dir, name);
    if ( statSync(p).isDirectory() ) walk(p, out);
    else out.push(p);
  }
  return out;
}

function flattenKeys(obj, prefix = "", out = new Set()) {
  for ( const [k, v] of Object.entries(obj) ) {
    const key = prefix ? `${prefix}.${k}` : k;
    if ( v && (typeof v === "object") ) flattenKeys(v, key, out);
    else out.add(key);
  }
  return out;
}

/**
 * Follow static imports (not dynamic import()) breadth-first from an entry point.
 * A file's depth is the number of sequential fetches before the browser can request it: the entry is 1, files it
 * imports are 2, and so on. The browser discovers a file at its shallowest import, so BFS order gives the real depth.
 */
function eagerGraph(entry) {
  const depth = new Map([[entry, 1]]);
  const queue = [entry];
  while ( queue.length ) {
    const file = queue.shift();
    const src = readFileSync(file, "utf8");
    const imports = src.matchAll(/^\s*import\s+(?:[^;]*?from\s+)?["'](\.[^"']+)["']/gm);
    for ( const m of imports ) {
      const dep = resolve(dirname(file), m[1]);
      if ( depth.has(dep) ) continue;
      depth.set(dep, depth.get(file) + 1);
      queue.push(dep);
    }
  }
  return depth;
}

for ( const id of readdirSync(MODULES) ) {
  const dir = join(MODULES, id);
  const manifestPath = join(dir, "module.json");
  if ( !existsSync(manifestPath) ) continue;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const where = `modules/${id}`;

  if ( manifest.id !== id ) fail(where, `manifest id "${manifest.id}" does not match folder name`);
  for ( const field of ["title", "version", "compatibility", "esmodules"] ) {
    if ( !manifest[field] ) fail(where, `manifest is missing "${field}"`);
  }
  if ( manifest.scripts?.length ) fail(where, "use esmodules, not scripts");
  for ( const p of [...(manifest.esmodules ?? []), ...(manifest.styles ?? []), ...(manifest.languages ?? []).map(l => l.path)] ) {
    if ( !existsSync(join(dir, p)) ) fail(where, `manifest references missing file ${p}`);
  }

  // Syntax
  const sources = walk(dir).filter(f => /\.m?js$/.test(f));
  for ( const file of sources ) {
    try {
      execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    } catch(err) {
      fail(relative(ROOT, file), err.stderr?.toString().trim() ?? "syntax error");
    }
  }

  // Localization: every literal key used in code must exist in every language file
  const prefixes = new Set();
  const used = new Set();
  for ( const file of sources ) {
    const src = readFileSync(file, "utf8");
    for ( const m of src.matchAll(/["'`]([A-Z][A-Z0-9]+)\.([A-Za-z0-9.]+)["'`]/g) ) {
      prefixes.add(m[1]);
      used.add(`${m[1]}.${m[2]}`);
    }
  }
  for ( const lang of manifest.languages ?? [] ) {
    const keys = flattenKeys(JSON.parse(readFileSync(join(dir, lang.path), "utf8")));
    for ( const key of used ) {
      if ( [...prefixes].some(p => key.startsWith(`${p}.`)) && !keys.has(key) && /^[A-Z]+\.[A-Z]/.test(key) ) {
        fail(`${where}/${lang.path}`, `missing localization key ${key}`);
      }
    }
  }

  // Eager-load budget: what every client downloads and evaluates before the game starts
  const depths = new Map();
  for ( const entry of manifest.esmodules ?? [] ) {
    for ( const [file, d] of eagerGraph(join(dir, entry)) ) depths.set(file, Math.min(d, depths.get(file) ?? Infinity));
  }
  const files = [...depths.keys()];
  const bytes = files.reduce((sum, f) => sum + statSync(f).size, 0);
  const maxDepth = Math.max(0, ...depths.values());
  console.log(`${where}: ${files.length} eagerly loaded files, ${(bytes / 1024).toFixed(1)} KB unminified, `
    + `${maxDepth} sequential fetch wave(s)`);
  if ( files.length > EAGER_BUDGET.files ) fail(where, `eager import graph has ${files.length} files (budget ${EAGER_BUDGET.files})`);
  if ( bytes > EAGER_BUDGET.bytes ) fail(where, `eager import graph is ${bytes} bytes (budget ${EAGER_BUDGET.bytes})`);
  if ( maxDepth > EAGER_BUDGET.depth ) {
    const deep = files.filter(f => depths.get(f) > EAGER_BUDGET.depth).map(f => relative(dir, f));
    fail(where, `eager imports are ${maxDepth} waves deep (budget ${EAGER_BUDGET.depth}); import these from the entry file: ${deep.join(", ")}`);
  }
}

if ( failures ) {
  console.error(`\n${failures} problem(s) found.`);
  process.exit(1);
}
console.log("All checks passed.");
