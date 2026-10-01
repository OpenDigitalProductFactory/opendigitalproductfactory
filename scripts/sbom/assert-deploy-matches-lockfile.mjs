#!/usr/bin/env node
// scripts/sbom/assert-deploy-matches-lockfile.mjs
//
// Proves a `pnpm deploy` output tree ships only what pnpm-lock.yaml locked.
//
// `pnpm install --frozen-lockfile` guarantees the workspace install matches the
// lockfile, but the service images then run `pnpm deploy --legacy`, which does
// its own install into the deploy directory. That second install reads the
// lockfile only under the isolated node linker. Under `node-linker=hoisted` (the
// repo root .npmrc) it prints "The current configuration prohibits to read or
// write a lockfile" and resolves every range afresh from the registry, and
// `--frozen-lockfile` on the deploy does not stop it. Replayed on the edge-node
// build stage with .npmrc present, the deploy shipped net-snmp 3.29.1 while the
// lockfile locks 3.26.3. Nothing in the build failed.
//
// So the image asserts the result rather than trusting the configuration: every
// registry package found in the deploy tree must be a name@version inside the
// lockfile's production closure for that importer (computed by the same graph
// walk as `pnpm surface`). First-party workspace packages are matched by the
// version in their own package.json. An empty tree fails: nothing to check is
// not a pass.
//
// Usage (inside an image build stage, after `pnpm deploy`):
//   node scripts/sbom/assert-deploy-matches-lockfile.mjs \
//     --root /app --importer services/edge-node --deploy /app/deploy/edge-node

import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs as utilParseArgs } from "node:util";

import { baseKey, closureFromKeys, collectProdRoots, loadGraph } from "./runtime-surface.mjs";

/**
 * Every installed package under a node_modules tree, as { name, version, path }.
 * Covers both layouts pnpm deploy can produce: the isolated virtual store
 * (node_modules/.pnpm/<key>/node_modules/<name>) and hoisted/nested trees.
 * Symlinks are skipped; the directory they point at is reached through .pnpm.
 */
export function listInstalledPackages(nodeModulesDir) {
  const found = [];
  const visit = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      if (entry === ".bin" || entry.endsWith(".yaml") || entry.endsWith(".json")) continue;
      const full = join(dir, entry);
      const stat = lstatSync(full);
      if (stat.isSymbolicLink() || !stat.isDirectory()) continue;
      if (entry === ".pnpm") {
        for (const key of readdirSync(full)) visit(join(full, key, "node_modules"));
        continue;
      }
      if (entry.startsWith("@")) {
        visit(full);
        continue;
      }
      const manifest = join(full, "package.json");
      if (existsSync(manifest)) {
        const { name, version } = JSON.parse(readFileSync(manifest, "utf8"));
        if (name && version) found.push({ name, version, path: full });
      }
      visit(join(full, "node_modules"));
    }
  };
  visit(nodeModulesDir);
  return found;
}

/**
 * Lockfile-sanctioned name@version set for one importer's production closure,
 * plus the first-party workspace packages it links to (name -> local version).
 */
export function allowedForImporter(root, importer) {
  const { importers, snapshots } = loadGraph(root);
  if (!importers[importer]) {
    throw new Error(`importer ${importer} is not in ${root}/pnpm-lock.yaml`);
  }
  const external = new Set(
    [...closureFromKeys(snapshots, collectProdRoots(importers, [importer]))].map(baseKey),
  );
  const workspace = new Map();
  for (const ws of Object.keys(importers)) {
    const manifest = join(root, ws, "package.json");
    if (!existsSync(manifest)) continue; // not copied into this build stage
    const { name, version } = JSON.parse(readFileSync(manifest, "utf8"));
    if (name) workspace.set(name, version);
  }
  return { external, workspace };
}

/** Deployed packages the lockfile did not lock, as human-readable problems. */
export function findUnlockedPackages(installed, { external, workspace }) {
  const problems = [];
  const seen = new Set();
  for (const { name, version, path } of installed) {
    const key = `${name}@${version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (workspace.has(name)) {
      if (workspace.get(name) !== version) {
        problems.push(`${key} (${path}): workspace package, local version is ${workspace.get(name)}`);
      }
      continue;
    }
    if (!external.has(key)) {
      const locked = [...external].filter((k) => k.slice(0, k.lastIndexOf("@")) === name);
      problems.push(
        `${key} (${path}): not in the lockfile closure` +
          (locked.length ? `; the lockfile locks ${locked.join(", ")}` : "; the lockfile does not list it"),
      );
    }
  }
  return { problems, checked: seen.size };
}

function cliOptions(args) {
  const { values } = utilParseArgs({
    args,
    options: {
      root: { type: "string" },
      importer: { type: "string" },
      deploy: { type: "string" },
    },
  });
  for (const k of ["importer", "deploy"]) if (!values[k]) throw new Error(`--${k} is required`);
  return { root: resolve(values.root ?? process.cwd()), importer: values.importer, deploy: resolve(values.deploy) };
}

function main() {
  const { root, importer, deploy } = cliOptions(process.argv.slice(2));
  const installed = listInstalledPackages(join(deploy, "node_modules"));
  const { problems, checked } = findUnlockedPackages(installed, allowedForImporter(root, importer));
  if (checked === 0) {
    console.error(`[deploy-lockfile] FAIL — no packages found under ${deploy}/node_modules.`);
    process.exit(1);
  }
  if (problems.length) {
    console.error(`[deploy-lockfile] FAIL — ${deploy} ships ${problems.length} package(s) pnpm-lock.yaml did not lock:`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error(
      "The deploy re-resolved from the registry instead of reading the lockfile. Check for a copied " +
        ".npmrc (node-linker=hoisted makes the legacy deploy skip the lockfile).",
    );
    process.exit(1);
  }
  console.log(`[deploy-lockfile] OK — ${checked} package(s) in ${deploy} match pnpm-lock.yaml (${importer}).`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
