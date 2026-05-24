#!/usr/bin/env node
/**
 * BI-04701325 Phase 1 — Security inflow gate.
 *
 * Compares current open CodeQL alerts against the committed baseline at
 * docs/security/codeql-baseline.json. Fails CI if any NEW alert at the
 * configured severity floor appears (by alert number — CodeQL assigns a
 * stable number per finding instance, so "in current AND not in baseline"
 * = "introduced by this PR").
 *
 * Severity floor (FAIL_SEVERITIES env, default "critical,high,medium"):
 *   Tightened from "critical,high" once the 2026-05 burn-down brought the
 *   baseline to 0 alerts. With a clean baseline, MEDIUM-floor protection
 *   adds coverage at no cost to existing PRs.
 *
 * Baseline content:
 *   Empty after the 2026-05 burn-down. Pre-existing alerts captured here
 *   are accepted findings (false positives with documented dismissals, or
 *   tracked-debt items that maintainers have explicitly agreed to defer).
 *   They do NOT block unrelated PRs.
 *
 * Why alert-number diffing (not severity-count diffing):
 *   A simple count comparison would let a PR that closes one critical and
 *   opens a different one through (net change = 0). Number-diffing catches
 *   that.
 *
 * Run locally:
 *   GH_REPOSITORY=OpenDigitalProductFactory/opendigitalproductfactory \
 *     GH_TOKEN=$(gh auth token) \
 *     node scripts/security/check-inflow-gate.mjs
 *
 * Environment:
 *   GH_REPOSITORY    Required. owner/repo.
 *   GH_TOKEN         Required. Token with security-events:read.
 *   BASELINE_PATH    Optional. Default: docs/security/codeql-baseline.json.
 *   FAIL_SEVERITIES  Optional. Comma-separated severity floor.
 *                    Default: "critical,high".
 *   PR_HEAD_SHA      Optional. Used only for diagnostic output.
 *   PR_DISPLAY_TITLE Optional. Used only for diagnostic output.
 *
 * Exit codes:
 *   0  No new findings vs baseline.
 *   1  New findings introduced (PR should be blocked).
 *   2  Configuration error (missing env, can't reach API, etc).
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// Default raised to include "medium" after the 2026-05 burn-down brought the
// baseline to 0 alerts. With a clean baseline, the cost of tightening is low
// and the protection covers a larger share of real findings.
const FAIL_SEVERITIES = (process.env.FAIL_SEVERITIES ?? "critical,high,medium")
  .split(",")
  .map((s) => s.trim().toLowerCase());
const BASELINE_PATH = process.env.BASELINE_PATH ?? "docs/security/codeql-baseline.json";
const repo = process.env.GH_REPOSITORY;
const token = process.env.GH_TOKEN;

if (!repo) {
  console.error("ERROR: GH_REPOSITORY env var is required (e.g. owner/repo).");
  process.exit(2);
}
if (!token) {
  console.error("ERROR: GH_TOKEN env var is required (security-events:read scope).");
  process.exit(2);
}

async function fetchOpenAlerts() {
  const out = [];
  let page = 1;
  // GitHub caps page_size at 100. Loop until a short page or empty.
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
      const body = await res.text();
      throw new Error(`GH API ${res.status} on page ${page}: ${body.slice(0, 400)}`);
    }
    const items = await res.json();
    if (!Array.isArray(items)) {
      throw new Error(`Unexpected response shape on page ${page}: ${JSON.stringify(items).slice(0, 200)}`);
    }
    out.push(...items);
    if (items.length < 100) break;
    page++;
    if (page > 50) throw new Error("Pagination runaway (>5000 alerts)");
  }
  return out;
}

let baseline;
try {
  const raw = await readFile(resolve(BASELINE_PATH), "utf8");
  baseline = JSON.parse(raw);
} catch (err) {
  console.error(`ERROR: Could not read baseline at ${BASELINE_PATH}: ${err.message}`);
  console.error("Generate one with: node scripts/security/regenerate-baseline.mjs");
  process.exit(2);
}

if (!Array.isArray(baseline.alerts)) {
  console.error(`ERROR: Baseline file missing required field 'alerts' (array). Got: ${typeof baseline.alerts}`);
  process.exit(2);
}

const baselineNumbers = new Set(baseline.alerts.map((a) => a.number));

let current;
try {
  current = await fetchOpenAlerts();
} catch (err) {
  console.error(`ERROR: Could not fetch alerts: ${err.message}`);
  process.exit(2);
}

const introduced = current.filter((alert) => {
  if (baselineNumbers.has(alert.number)) return false;
  const sev = (alert.rule?.security_severity_level ?? "").toLowerCase();
  return FAIL_SEVERITIES.includes(sev);
});

// Surface what's CLOSED too — informational. Helps maintainers know the
// baseline needs regenerating when a PR fixes findings.
const currentNumbers = new Set(current.map((a) => a.number));
const closedSinceBaseline = baseline.alerts.filter((a) => !currentNumbers.has(a.number));

console.log(`Baseline: ${baseline.alerts.length} accepted findings (snapshot: ${baseline.generatedAt ?? "unknown"})`);
console.log(`Current:  ${current.length} open findings`);
if (process.env.PR_HEAD_SHA) {
  console.log(`PR head:  ${process.env.PR_HEAD_SHA}${process.env.PR_DISPLAY_TITLE ? ` — ${process.env.PR_DISPLAY_TITLE}` : ""}`);
}
console.log("");

if (closedSinceBaseline.length > 0) {
  console.log(`ℹ ${closedSinceBaseline.length} baseline finding(s) closed since baseline snapshot:`);
  for (const a of closedSinceBaseline) {
    console.log(`   #${a.number} ${(a.severity ?? "").toUpperCase()} ${a.ruleId} — ${a.path}:${a.startLine}`);
  }
  console.log("   Consider regenerating the baseline: node scripts/security/regenerate-baseline.mjs");
  console.log("");
}

if (introduced.length === 0) {
  console.log(`✓ Inflow gate PASSED — no new ${FAIL_SEVERITIES.join("/")} CodeQL findings introduced.`);
  process.exit(0);
}

console.error(`✗ Inflow gate FAILED — ${introduced.length} new ${FAIL_SEVERITIES.join("/")} CodeQL finding(s) introduced by this PR:`);
console.error("");
for (const a of introduced) {
  const sev = (a.rule?.security_severity_level ?? "?").toUpperCase();
  const loc = `${a.most_recent_instance?.location?.path ?? "?"}:${a.most_recent_instance?.location?.start_line ?? "?"}`;
  console.error(`  #${a.number} ${sev} ${a.rule?.id ?? "?"}`);
  console.error(`     ${loc}`);
  console.error(`     ${a.html_url}`);
  if (a.most_recent_instance?.message?.text) {
    console.error(`     ${a.most_recent_instance.message.text.split("\n")[0]}`);
  }
  console.error("");
}

console.error("How to resolve");
console.error("--------------");
console.error("  1. Fix the finding (preferred). See BI-04701325 and AGENTS.md for the");
console.error("     security intake process — every fix carries a regression test first.");
console.error("");
console.error("  2. If a false positive: dismiss it in the GitHub UI WITH a written");
console.error("     justification citing a kernel principle or BI. CodeQL suppressions");
console.error("     should also be encoded in .github/codeql/config.yml so they persist.");
console.error("");
console.error("  3. After resolving (fix OR dismiss), regenerate the baseline:");
console.error("       GH_REPOSITORY=… GH_TOKEN=… node scripts/security/regenerate-baseline.mjs");
console.error("     Commit the updated baseline alongside the fix.");

process.exit(1);
