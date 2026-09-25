#!/usr/bin/env node
// scripts/sbom/runtime-surface.mjs
//
// Splits the external dependency set into what actually RUNS in the deployed
// server runtime versus what is only present at build/dev/test time (or in the
// mobile client). The supply-chain threat model is not uniform: a compromised
// dev/build dependency can attack CI + developer machines, but only the
// production-runtime closure ships inside the deployed images (dpf-portal /
// dpf-adp / dpf-edge-node) and can touch live data + secrets. Shrinking and
// watching that runtime number is the lever.
//
// Computed purely from pnpm-lock.yaml: the production-`dependencies` closure of
// the deployed workspaces, following first-party workspace links and the
// resolved `snapshots:` graph. Approximate at the margins (a tree-shaken prod
// bundle ships a subset) but a sound upper bound on "what could run".
//
// Also exports the lockfile graph (loadGraph / collectProdRoots /
// closureFromKeys / baseKey) reused by internalization-candidates.mjs.
//
// Usage: node scripts/sbom/runtime-surface.mjs   (alias: pnpm surface)

import { parseImporters, parsePackageKeys, parseSnapshots } from "../lib/pnpm-lock.mjs";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEPLOYED = ["apps/web", "services/adp", "services/edge-node"];

export { unquote } from "../lib/pnpm-lock.mjs";
export function baseKey(key) { return key.split("(")[0]; } // strip peer suffix → name@version
function posixJoin(base, rel) {
  const out = [];
  for (const p of (base + "/" + rel).split("/")) {
    if (p === "" || p === ".") continue;
    if (p === "..") out.pop(); else out.push(p);
  }
  return out.join("/");
}

// importers → { [ws]: { prod: [{name, value}], dev: [...] } }, where prod is
// dependencies + optionalDependencies and value is the raw locked version.
function toProdDev(importers) {
  const map = {};
  for (const [ws, entry] of Object.entries(importers)) {
    const pick = (list) => list.map((d) => ({ name: d.name, value: d.version }));
    map[ws] = {
      prod: [...pick(entry.dependencies), ...pick(entry.optionalDependencies)],
      dev: pick(entry.devDependencies),
    };
  }
  return map;
}

export function loadGraph(root = ROOT) {
  const text = readFileSync(`${root}/pnpm-lock.yaml`, "utf8");
  return {
    importers: toProdDev(parseImporters(text)),
    snapshots: parseSnapshots(text),
    totalExternal: new Set(parsePackageKeys(text)),
  };
}

// production-`dependencies` root snapshot keys for a set of workspaces,
// following first-party (@dpf/*) workspace links into their own prod deps.
export function collectProdRoots(importers, wsList) {
  const roots = new Set(), seen = new Set();
  function walk(ws) {
    if (seen.has(ws) || !importers[ws]) return;
    seen.add(ws);
    for (const dep of importers[ws].prod) {
      if (dep.value.startsWith("link:")) walk(posixJoin(ws, dep.value.slice(5)));
      else if (!dep.value.startsWith("workspace:")) roots.add(`${dep.name}@${dep.value}`);
    }
  }
  for (const ws of wsList) walk(ws);
  return roots;
}

// BFS over the snapshots graph from a set of root keys → all reachable full keys.
export function closureFromKeys(snapshots, rootKeys) {
  const visited = new Set();
  const queue = [...rootKeys];
  while (queue.length) {
    const key = queue.pop();
    if (visited.has(key)) continue;
    visited.add(key);
    for (const dep of snapshots.get(key) || []) if (!visited.has(dep)) queue.push(dep);
  }
  return visited;
}

export const DEPLOYED_WORKSPACES = DEPLOYED;

function main() {
  const { importers, snapshots, totalExternal } = loadGraph();
  const closureBase = (wsList) => new Set([...closureFromKeys(snapshots, collectProdRoots(importers, wsList))].map(baseKey));
  const portal = closureBase(["apps/web"]);
  const allDeployed = closureBase(DEPLOYED);
  const total = totalExternal.size;
  const pct = (n) => `${((n / total) * 100).toFixed(0)}%`;
  process.stdout.write(
    [
      `External resolved packages (total):        ${total}`,
      `Production-runtime closure — all deployed: ${allDeployed.size}  (${pct(allDeployed.size)})   [dpf-portal + dpf-adp + dpf-edge-node]`,
      `  portal alone (apps/web → dpf-portal):    ${portal.size}  (${pct(portal.size)})`,
      `Dev / build / test / mobile-only:          ${total - allDeployed.size}  (${pct(total - allDeployed.size)})   [never ships to the server]`,
      "",
      "Threat-model note: the dev/build set can attack CI + developer machines (real,",
      "but contained by pnpm allowBuilds + integrity + frozen-lockfile); only the",
      "production-runtime closure can touch live data/secrets in a deployed install.",
      "Approximate upper bound — a tree-shaken Next.js prod bundle ships a subset.",
      "",
    ].join("\n"),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
