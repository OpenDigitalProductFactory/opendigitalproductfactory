#!/usr/bin/env node
// scripts/sbom/check-sbom-drift.mjs
//
// Reduction/efficiency guard — the proactive counterpart to Dependabot.
// Dependabot spots vulnerabilities + lifecycle (reactive, per-package).
// This guard spots DEPENDENCY-SHAPE regressions across the whole monorepo
// that Dependabot structurally cannot see:
//
//   HARD GATE  — a NEW first-party version split (our own workspaces start
//                declaring a package at incompatible versions). Dependabot
//                bumps one package at a time and is configured never to move
//                majors for typescript/react/expo, so it will never flag this.
//   REPORT     — change in total fan-out / multi-major counts vs the baseline,
//                printed for visibility (never fails the build — transitive
//                churn from routine Dependabot bumps is expected).
//
// Pure Node: no install, runs in seconds. Mirrors the repo's other
// scripts/check-*.mjs CI guards.
//
// Usage:
//   node scripts/sbom/check-sbom-drift.mjs                 # gate (CI / pre-PR)
//   node scripts/sbom/check-sbom-drift.mjs --update-baseline  # accept current shape

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generatePlatformSbom } from "./generate-platform-sbom.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASELINE_PATH = join(ROOT, "sbom", "baseline.json");
const update = process.argv.includes("--update-baseline");

function loadBaseline() {
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    return null;
  }
}

function main() {
  const gitRef = process.env.GITHUB_SHA ?? process.env.GIT_COMMIT ?? "unknown";
  // Fixed timestamp: the drift verdict must depend only on the lockfile,
  // never on wall-clock, so reruns of the same commit are identical.
  const { analysis } = generatePlatformSbom({ root: ROOT, gitRef, generatedAt: new Date(0) });
  const t = analysis.totals;
  const currentDivergent = analysis.firstPartyDivergent.map((d) => d.name).sort();

  if (update) {
    const baseline = {
      note: "Drift anchor for scripts/check-sbom-drift.mjs. `firstPartyDivergent` lists the accepted set of packages whose own workspace declarations resolve to >1 version; the guard fails when a NEW name appears. Update intentionally (align the versions, or accept here) — never to silence a real regression. Totals are informational. See docs/architecture/dependency-reduction-routine.md.",
      totals: t,
      firstPartyDivergent: currentDivergent,
    };
    writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
    process.stdout.write(`Baseline updated: ${BASELINE_PATH}\n  firstPartyDivergent=[${currentDivergent.join(", ")}] excessInstances=${t.excessInstances}\n`);
    return;
  }

  const baseline = loadBaseline();
  if (!baseline) {
    process.stderr.write(`::error::No SBOM baseline at ${BASELINE_PATH}. Create one with: node scripts/sbom/check-sbom-drift.mjs --update-baseline\n`);
    process.exit(1);
  }

  const accepted = new Set(baseline.firstPartyDivergent ?? []);
  const newDivergent = currentDivergent.filter((n) => !accepted.has(n));
  const resolved = [...accepted].filter((n) => !currentDivergent.includes(n));

  // informational deltas
  const d = (key) => t[key] - (baseline.totals?.[key] ?? 0);
  const sign = (n) => (n > 0 ? `+${n}` : `${n}`);
  process.stdout.write(
    [
      "SBOM dependency-shape report (vs baseline):",
      `  resolved components : ${t.resolvedComponents} (${sign(d("resolvedComponents"))})`,
      `  duplicated names    : ${t.duplicatedNames} (${sign(d("duplicatedNames"))})`,
      `  excess instances    : ${t.excessInstances} (${sign(d("excessInstances"))})`,
      `  multi-major names   : ${t.multiMajorNames} (${sign(d("multiMajorNames"))})`,
      `  first-party splits  : ${t.firstPartyDivergentNames} (${sign(d("firstPartyDivergentNames"))})`,
      "",
    ].join("\n"),
  );

  if (resolved.length) {
    process.stdout.write(`Resolved first-party splits (consider ratcheting the baseline down): ${resolved.join(", ")}\n`);
  }

  if (newDivergent.length) {
    const detail = analysis.firstPartyDivergent
      .filter((x) => newDivergent.includes(x.name))
      .map((x) => `    - ${x.name}: our declarations resolve to ${x.ourVersions.join(", ")} across ${x.directInWorkspaces.join(", ")}`)
      .join("\n");
    process.stderr.write(
      [
        `::error::New first-party version split introduced: ${newDivergent.join(", ")}`,
        detail,
        "",
        "  A package is now declared at incompatible versions across our own workspaces.",
        "  Fix by aligning the declared specifiers to one major (preferred), or — if the",
        "  split is intentional and unavoidable — accept it:",
        "    node scripts/sbom/check-sbom-drift.mjs --update-baseline",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }

  process.stdout.write("OK — no new first-party version splits.\n");
}

main();
