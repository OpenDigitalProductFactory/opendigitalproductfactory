#!/usr/bin/env node
/**
 * BI-04701325 Phase 1 — Regenerate the CodeQL baseline snapshot.
 *
 * Captures the current open CodeQL alerts into docs/security/codeql-baseline.json
 * so future PRs only need to clear NEW findings, not historical ones.
 *
 * Run this:
 *   - After fixing one or more baseline findings (so the baseline shrinks).
 *   - After dismissing a false positive in the GitHub UI (with justification).
 *   - Never to "silence" an unfixed new finding — that defeats the gate.
 *
 * Usage:
 *   GH_REPOSITORY=OpenDigitalProductFactory/opendigitalproductfactory \
 *     GH_TOKEN=$(gh auth token) \
 *     node scripts/security/regenerate-baseline.mjs
 *
 * Optional env:
 *   BASELINE_PATH  Default: docs/security/codeql-baseline.json
 */

import { writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { mkdir } from "node:fs/promises";

const BASELINE_PATH = process.env.BASELINE_PATH ?? "docs/security/codeql-baseline.json";
const repo = process.env.GH_REPOSITORY;
const token = process.env.GH_TOKEN;

if (!repo || !token) {
  console.error("ERROR: GH_REPOSITORY and GH_TOKEN env vars are required.");
  process.exit(2);
}

async function fetchOpenAlerts() {
  const out = [];
  let page = 1;
  while (true) {
    const url = `https://api.github.com/repos/${repo}/code-scanning/alerts?state=open&per_page=100&page=${page}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!res.ok) {
      throw new Error(`GH API ${res.status}: ${(await res.text()).slice(0, 400)}`);
    }
    const items = await res.json();
    out.push(...items);
    if (items.length < 100) break;
    page++;
    if (page > 50) throw new Error("Pagination runaway");
  }
  return out;
}

const current = await fetchOpenAlerts();

const baseline = {
  $schema: "./codeql-baseline.schema.json",
  description:
    "CodeQL findings accepted as pre-existing at the time of snapshot. The security-inflow-gate workflow blocks PRs that introduce alert NUMBERS not in this list. Burn-down is tracked via the cluster BIs referenced in docs/security/README.md.",
  generatedAt: new Date().toISOString(),
  repository: repo,
  alerts: current
    .map((a) => ({
      number: a.number,
      ruleId: a.rule?.id ?? null,
      severity: a.rule?.security_severity_level ?? null,
      path: a.most_recent_instance?.location?.path ?? null,
      startLine: a.most_recent_instance?.location?.start_line ?? null,
      createdAt: a.created_at,
    }))
    .sort((a, b) => a.number - b.number),
};

const fullPath = resolve(BASELINE_PATH);
await mkdir(dirname(fullPath), { recursive: true });
await writeFile(fullPath, JSON.stringify(baseline, null, 2) + "\n", "utf8");

// Summary
const bySeverity = {};
for (const a of baseline.alerts) {
  const s = a.severity ?? "unknown";
  bySeverity[s] = (bySeverity[s] ?? 0) + 1;
}

console.log(`✓ Wrote ${baseline.alerts.length} alerts to ${BASELINE_PATH}`);
console.log("  By severity:");
for (const [sev, n] of Object.entries(bySeverity).sort()) {
  console.log(`    ${sev.padEnd(8)} ${n}`);
}
