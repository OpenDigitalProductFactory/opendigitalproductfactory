#!/usr/bin/env node
// scripts/sbom/check-singleton-safety.mjs
//
// Dual-package-hazard guard. Most duplicate packages are harmless — pure
// utilities where multiple copies are just bytes. But a small class of
// SINGLETON / instanceof / global-state libraries breaks when two copies load
// in one runtime: React's hook dispatcher, zod/immer/redux instanceof + state,
// graphql/apollo schema identity, emotion/styled-components context caches, the
// query-client context. Two versions => two physical modules => instanceof
// fails across them and state desyncs. This is the duplication that actually
// "causes disparities over time"; the rest doesn't.
//
// Fails CI when a known dual-hazard library goes MULTI-MAJOR in the
// PRODUCTION-RUNTIME closure (where the hazard bites — not build/dev tooling,
// and not apps/mobile's separate react-native renderer tree). Ignores the ~200
// harmless utility dups. Reviewed exceptions live in sbom/singleton-baseline.json.
// See docs/architecture/dependency-reduction-routine.md.
//
// Usage:
//   node scripts/sbom/check-singleton-safety.mjs                    # gate
//   node scripts/sbom/check-singleton-safety.mjs --update-baseline  # accept current

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadGraph, collectProdRoots, closureFromKeys, baseKey, DEPLOYED_WORKSPACES } from "./runtime-surface.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASELINE_PATH = join(ROOT, "sbom", "singleton-baseline.json");
const update = process.argv.includes("--update-baseline");

// Libraries that break when two copies share a runtime (instanceof / singleton
// / global state). Curated — only genuine hazards, not every dependency.
const DUAL_HAZARD = new Set([
  "react", "react-dom", "react-is", "scheduler", "react-reconciler",
  "zod", "immer", "mobx", "mobx-react-lite", "redux", "react-redux", "@reduxjs/toolkit",
  "rxjs", "graphql", "@apollo/client", "@tanstack/react-query", "valtio", "jotai", "recoil",
  "styled-components", "@emotion/react", "@emotion/styled", "@emotion/core",
]);

function splitNameVersion(key) {
  const base = key.split("(")[0];
  const at = base.lastIndexOf("@");
  if (at <= 0) return null;
  return { name: base.slice(0, at), version: base.slice(at + 1) };
}
const major = (v) => {
  const n = parseInt(v.split(".")[0], 10);
  return Number.isNaN(n) ? v.split(".")[0] : n;
};

function loadBaseline() {
  try { return JSON.parse(readFileSync(BASELINE_PATH, "utf8")); } catch { return null; }
}

// dual-hazard packages present at >1 version in the production-runtime closure
function computeHazards() {
  const { importers, snapshots } = loadGraph(ROOT);
  const runtimeKeys = closureFromKeys(snapshots, collectProdRoots(importers, DEPLOYED_WORKSPACES));
  const byName = new Map();
  for (const key of runtimeKeys) {
    const nv = splitNameVersion(baseKey(key));
    if (!nv || !DUAL_HAZARD.has(nv.name)) continue;
    if (!byName.has(nv.name)) byName.set(nv.name, new Set());
    byName.get(nv.name).add(nv.version);
  }
  return [...byName.entries()]
    .map(([name, set]) => {
      const versions = [...set].sort();
      const majors = [...new Set(versions.map(major))];
      return { name, versions, majorCount: majors.length, majors };
    })
    .filter((h) => h.versions.length > 1)
    .sort((a, b) => b.majorCount - a.majorCount || a.name.localeCompare(b.name));
}

function main() {
  const hazards = computeHazards();
  const multiMajor = hazards.filter((h) => h.majorCount > 1);

  if (update) {
    const baseline = {
      note: "Accepted dual-package-hazard duplicates for scripts/sbom/check-singleton-safety.mjs. A singleton/instanceof/state library at multiple MAJORS in the production-runtime closure is gated; entries here are reviewed exceptions (contained: transitive-only and/or behind a separate renderer/realm boundary). Each needs a real `reason`. See docs/architecture/dependency-reduction-routine.md.",
      accepted: multiMajor.map((h) => ({ name: h.name, versions: h.versions, majors: h.majors, reason: "REVIEW — confirm the copies never exchange instances across the boundary" })),
    };
    writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
    process.stdout.write(`Baseline updated: ${BASELINE_PATH} (${baseline.accepted.length} accepted)\n`);
    return;
  }

  const baseline = loadBaseline() || { accepted: [] };
  const accepted = new Set((baseline.accepted || []).map((a) => a.name));

  const sameMajor = hazards.filter((h) => h.majorCount === 1);
  if (sameMajor.length) {
    process.stdout.write("Advisory — dual-hazard packages duplicated within one major:\n");
    for (const h of sameMajor) process.stdout.write(`  ${h.name}: ${h.versions.join(", ")}\n`);
  }

  const newHazards = multiMajor.filter((h) => !accepted.has(h.name));
  if (newHazards.length) {
    process.stderr.write(
      [
        `::error::${newHazards.length} singleton / dual-package-hazard library(ies) at MULTIPLE MAJORS in the production runtime:`,
        ...newHazards.map((h) => `    - ${h.name}: ${h.versions.join(", ")} (majors ${h.majors.join("/")})`),
        "",
        "  Two copies of a singleton/instanceof library in one runtime cause instanceof",
        "  failures + state desync. Resolve to ONE major (align consumers, or pin via",
        "  pnpm-workspace overrides). If the copies are provably isolated (transitive-only,",
        "  separate renderer/realm), accept with a reason:",
        "    node scripts/sbom/check-singleton-safety.mjs --update-baseline",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }
  process.stdout.write(`OK — no new dual-package hazards (${multiMajor.length} accepted multi-major, ${hazards.length} hazard-class dups in runtime).\n`);
}

main();
