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

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEPLOYED = ["apps/web", "services/adp", "services/edge-node"];

export function unquote(s) { return s.replace(/^['"]|['"]$/g, ""); }
export function baseKey(key) { return key.split("(")[0]; } // strip peer suffix → name@version
function posixJoin(base, rel) {
  const out = [];
  for (const p of (base + "/" + rel).split("/")) {
    if (p === "" || p === ".") continue;
    if (p === "..") out.pop(); else out.push(p);
  }
  return out.join("/");
}

function parseImporters(lines, from, to) {
  const map = {};
  let ws = null, kind = null, name = null;
  for (let i = from + 1; i < to; i++) {
    const l = lines[i];
    let m = l.match(/^ {2}(\S.*):$/);
    if (m) { ws = m[1]; map[ws] = { prod: [], dev: [] }; kind = null; name = null; continue; }
    let k = l.match(/^ {4}(dependencies|devDependencies|optionalDependencies):$/);
    if (k) { kind = k[1]; name = null; continue; }
    let n = l.match(/^ {6}(\S.*):$/);
    if (n && kind) { name = unquote(n[1]); continue; }
    let v = l.match(/^ {8}version: (.+)$/);
    if (v && ws && kind && name) {
      const entry = { name, value: unquote(v[1].trim()) };
      if (kind === "devDependencies") map[ws].dev.push(entry); else map[ws].prod.push(entry);
      name = null;
    }
  }
  return map;
}

function parseSnapshots(lines, from) {
  const map = new Map();
  let key = null, inDeps = false;
  for (let i = from + 1; i < lines.length; i++) {
    const l = lines[i];
    let m = l.match(/^ {2}(\S.*?):(?:\s*\{\})?$/);
    if (m) { key = unquote(m[1]); map.set(key, []); inDeps = false; continue; }
    let k = l.match(/^ {4}(dependencies|optionalDependencies):$/);
    if (k) { inDeps = true; continue; }
    if (/^ {4}\S/.test(l)) inDeps = false;
    let d = l.match(/^ {6}(\S.*?): (.+)$/);
    if (d && key && inDeps) map.get(key).push(`${unquote(d[1])}@${unquote(d[2].trim())}`);
  }
  return map;
}

export function loadGraph(root = ROOT) {
  const lines = readFileSync(`${root}/pnpm-lock.yaml`, "utf8").replace(/\r\n/g, "\n").split("\n");
  const iImp = lines.indexOf("importers:"), iPkg = lines.indexOf("packages:"), iSnap = lines.indexOf("snapshots:");
  const importers = parseImporters(lines, iImp, iPkg);
  const snapshots = parseSnapshots(lines, iSnap);
  const totalExternal = new Set();
  for (let i = iPkg + 1; i < iSnap; i++) {
    const m = lines[i].match(/^ {2}(\S.*):$/);
    if (m) totalExternal.add(unquote(m[1]));
  }
  return { importers, snapshots, totalExternal };
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
