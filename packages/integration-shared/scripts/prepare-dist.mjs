#!/usr/bin/env node
// Makes the compiled dist/ of @dpf/integration-shared loadable by Node as an
// installed dependency. Run after `tsc`, in image builds only (services/adp).
//
// In the repo the package exports its TypeScript source, and the barrel
// re-exports without file extensions, because the web app's Turbopack build
// needs that form (see src/index.ts). Node can do neither inside node_modules:
// it does not strip types there, and ESM needs full relative specifiers. So an
// image that ships the package:
//   1. points main, types and every `exports` entry at dist/, and
//   2. gives every extensionless relative specifier in dist/*.js its `.js`.
//
// Usage (from the package directory): node scripts/prepare-dist.mjs

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** "./src/x.ts" -> "./dist/x.js"; anything else unchanged. */
export function toDistEntry(path) {
  return path.replace(/^\.\/src\//, "./dist/").replace(/\.ts$/, ".js");
}

/** A copy of the manifest with main, types and exports pointing at dist/. */
export function rewriteManifest(pkg) {
  const next = { ...pkg, main: toDistEntry(pkg.main) };
  next.types = next.main.replace(/\.js$/, ".d.ts");
  if (pkg.exports) {
    next.exports = Object.fromEntries(Object.entries(pkg.exports).map(([key, value]) => [key, toDistEntry(value)]));
  }
  return next;
}

const SPECIFIER_RE = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])(\.{1,2}\/[^"']*)\2/g;

/**
 * Add `.js` (or `/index.js`) to extensionless relative specifiers that name a
 * compiled file. `exists(relativeSpecifier)` answers for paths relative to the
 * importing file.
 */
export function addJsExtensions(source, exists) {
  return source.replace(SPECIFIER_RE, (match, lead, quote, spec) => {
    if (/\.(m?js|cjs|json)$/.test(spec)) return match;
    if (exists(`${spec}.js`)) return `${lead}${quote}${spec}.js${quote}`;
    if (exists(`${spec}/index.js`)) return `${lead}${quote}${spec}/index.js${quote}`;
    return match;
  });
}

function* jsFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* jsFiles(full);
    else if (full.endsWith(".js")) yield full;
  }
}

export function prepareDist(packageDir) {
  const manifestPath = join(packageDir, "package.json");
  const pkg = JSON.parse(readFileSync(manifestPath, "utf8"));
  writeFileSync(manifestPath, JSON.stringify(rewriteManifest(pkg), null, 2) + "\n");
  let rewritten = 0;
  for (const file of jsFiles(join(packageDir, "dist"))) {
    const source = readFileSync(file, "utf8");
    const next = addJsExtensions(source, (spec) => existsSync(resolve(dirname(file), spec)));
    if (next !== source) {
      writeFileSync(file, next);
      rewritten++;
    }
  }
  return { rewritten };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { rewritten } = prepareDist(process.cwd());
  console.log(`prepare-dist: manifest points at dist/; ${rewritten} file(s) given full relative specifiers.`);
}
