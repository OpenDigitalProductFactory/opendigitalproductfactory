#!/usr/bin/env node
// scripts/measure-doc-staleness-coverage.mjs
//
// BI-3E5969DF, SPIKE STEP — measure before gating.
//
// The BI asks for semantic doc-staleness detection: prose that drifted while its
// links still resolve. Before designing that, this measures what the EXISTING
// signals can see, because a detector's precision is irrelevant if its reach is
// small. audit-time-bombs.yml set the precedent — it chose a dynamic design only
// after measuring how noisy the static one was. This is the same step, run first.
//
// WHAT IS ALREADY HERE (verified, not assumed):
//   * check-doc-reference-integrity.mjs — dead links. Structural.
//   * gen-doc-impact.mjs + check-docs-impact.mjs — doc↔code/route edges. Structural.
//   * build-docs-staleness.mjs — a TIMESTAMP detector (BI-AA5DFEA2): flags a doc
//     whose referenced repo file was committed more recently than the doc itself.
//     Closer to semantic than the rest, but still not reading meaning.
//
// THE MEASUREMENT: every one of those signals is bounded by the same ceiling —
// a doc it has no edge to is a doc it cannot say anything about, at any precision.
// So the number that decides whether a semantic gate is worth building is not the
// false-positive rate, it is COVERAGE: what share of the published corpus carries
// any edge at all. This script computes that from committed artifacts only.
//
// DELIBERATELY NOT A GATE. It writes a report and exits 0. The BI's instruction is
// to measure the over-report rate on the live corpus BEFORE gating anything, and a
// signal that fires on a large share of pages trains reviewers to click through —
// worse than no signal. Whether any of this becomes binding is a later decision,
// taken on these numbers.
//
// Usage:
//   node scripts/measure-doc-staleness-coverage.mjs          # write the report
//   node scripts/measure-doc-staleness-coverage.mjs --check  # exit 1 if stale (CI)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { publishedDocFiles } from "./lib/published-doc-roots.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = path.join(REPO_ROOT, "apps", "web", "lib", "docs", "doc-impact.generated.json");
const STALENESS_REPORT_PATH = path.join(REPO_ROOT, "docs", "maintenance", "staleness-report.md");
const OUT_PATH = path.join(REPO_ROOT, "docs", "maintenance", "staleness-coverage.md");

/**
 * Machine-generated pages under docs/, excluded from the measured corpus.
 *
 * SELF-REFERENCE: this script's own output lives under docs/, so without this the
 * corpus grows by one the moment the report is written and `--check` can never be
 * satisfied — write, then immediately "stale". They are also the wrong thing to
 * measure: a generated report cannot have prose that drifted, which is the whole
 * population of interest.
 */
export const GENERATED_DOCS = new Set([
  "docs/maintenance/staleness-report.md",
  "docs/maintenance/staleness-coverage.md",
]);

/** Doc area = first path segment under docs/, e.g. "docs/user-guide/x.md" → "user-guide". */
export function docArea(docPath) {
  const parts = docPath.split("/");
  return parts.length > 2 ? parts[1] : "(root)";
}

/**
 * Coverage of a published corpus by the doc-impact edge set.
 *
 * PURE — takes data, returns data. No filesystem, no clock, so the numbers in the
 * committed report are reproducible from the same inputs by anyone.
 *
 * @param {string[]} corpus repo-relative published doc paths
 * @param {{docToCode?: Record<string,string[]>, docToRoutes?: Record<string,string[]>}} manifest
 * @returns {{total:number, covered:number, uncovered:number, coveredPct:number,
 *            byCodeOnly:number, byRouteOnly:number, byBoth:number,
 *            areas: Array<{area:string,total:number,covered:number,coveredPct:number}>}}
 */
export function computeCoverage(corpus, manifest) {
  const withCode = new Set(Object.keys(manifest.docToCode ?? {}));
  const withRoute = new Set(Object.keys(manifest.docToRoutes ?? {}));

  let byCodeOnly = 0;
  let byRouteOnly = 0;
  let byBoth = 0;
  const areas = new Map();

  for (const doc of corpus) {
    const c = withCode.has(doc);
    const r = withRoute.has(doc);
    if (c && r) byBoth++;
    else if (c) byCodeOnly++;
    else if (r) byRouteOnly++;

    const area = docArea(doc);
    const acc = areas.get(area) ?? { area, total: 0, covered: 0 };
    acc.total++;
    if (c || r) acc.covered++;
    areas.set(area, acc);
  }

  const covered = byCodeOnly + byRouteOnly + byBoth;
  const total = corpus.length;
  const pct = (n, d) => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);

  return {
    total,
    covered,
    uncovered: total - covered,
    coveredPct: pct(covered, total),
    byCodeOnly,
    byRouteOnly,
    byBoth,
    // Darkest areas first — that ordering IS the finding. Ties broken by size,
    // then name, so the table is stable across runs.
    areas: [...areas.values()]
      .map((a) => ({ ...a, coveredPct: pct(a.covered, a.total) }))
      .sort((x, y) => x.coveredPct - y.coveredPct || y.total - x.total || x.area.localeCompare(y.area)),
  };
}

/** Candidate count from the committed staleness report ("**3** stale-candidate doc(s)."). */
export function parseStalenessCandidates(reportText) {
  const m = reportText.match(/\*\*(\d+)\*\*\s+stale-candidate/);
  return m ? Number.parseInt(m[1], 10) : null;
}

export function renderReport(cov, candidates) {
  const L = [];
  L.push("---");
  L.push("title: Doc staleness — signal coverage measurement");
  L.push("area: maintenance");
  L.push("---");
  L.push("");
  L.push("# Doc staleness — signal coverage measurement");
  L.push("");
  L.push("> Generated by `scripts/measure-doc-staleness-coverage.mjs`. Do not edit by hand.");
  L.push("> This is a MEASUREMENT, not a gate — it exits 0 no matter what it finds.");
  L.push("");
  L.push("## Why this exists");
  L.push("");
  L.push("Every doc gate in this repo is structural: it checks that links resolve, that");
  L.push("edges are valid, that a retired substrate is not named. None of them reads what");
  L.push("a page *says*. Before building one that does (BI-3E5969DF), the question that");
  L.push("decides whether it is worth building is not how precise it would be — it is how");
  L.push("much of the corpus any signal can reach at all. A detector cannot report on a");
  L.push("page it has no edge to, at any precision.");
  L.push("");
  L.push("## The finding");
  L.push("");
  L.push(
    `**${cov.covered} of ${cov.total} published doc pages (${cov.coveredPct}%) carry a doc-impact edge.**`,
  );
  L.push(
    `The other **${cov.uncovered}** (${Math.round((1000 * cov.uncovered) / cov.total) / 10}%) carry none, and are invisible to`,
  );
  L.push("the doc-impact gate by construction — not because the gate is imprecise, but");
  L.push("because there is no edge along which it could ever be told to look.");
  L.push("");
  L.push("| Signal | Pages |");
  L.push("| ------ | ----- |");
  L.push(`| Code edges only | ${cov.byCodeOnly} |`);
  L.push(`| Route edges only | ${cov.byRouteOnly} |`);
  L.push(`| Both | ${cov.byBoth} |`);
  L.push(`| **No edge at all** | **${cov.uncovered}** |`);
  if (candidates !== null) {
    L.push("");
    L.push(
      `The timestamp detector (\`build-docs-staleness.mjs\`, BI-AA5DFEA2) currently reports **${candidates}** stale`,
    );
    L.push("candidate(s). That number is small because its reach is small, not because the");
    L.push("corpus is fresh — it can only ever flag a page that links a repo file.");
  }
  L.push("");
  L.push("## Coverage by area");
  L.push("");
  L.push("Darkest first. These are the areas where a semantic gate would be blind today.");
  L.push("");
  L.push("| Area | Pages | Covered | Coverage |");
  L.push("| ---- | ----- | ------- | -------- |");
  for (const a of cov.areas) {
    L.push(`| \`${a.area}\` | ${a.total} | ${a.covered} | ${a.coveredPct}% |`);
  }
  L.push("");
  L.push("## What this implies for BI-3E5969DF");
  L.push("");
  L.push("1. **Coverage is the binding constraint, not precision.** Tuning a semantic");
  L.push("   detector against the covered minority would leave the uncovered majority");
  L.push("   exactly as dark as it is now, while producing a green check that reads as");
  L.push("   \"docs are fine\" — the failure mode the");
  L.push("   [`gate-coverage-matches-blast-radius`](../founder-kernel/wiki/principles/gate-coverage-matches-blast-radius.md)");
  L.push("   principle names.");
  L.push("2. **Widening edges beats sharpening signal, for now.** PR #4004 already showed");
  L.push("   the cheap direction: derive edges from references docs already contain rather");
  L.push("   than ask authors to declare them (27 → 155 code edges, no annotation).");
  L.push("3. **Do not gate yet.** On this corpus a semantic detector cannot be honestly");
  L.push("   described as covering the docs. Advisory reporting first; binding later, and");
  L.push("   only against a measured over-report rate on a corpus it can actually see.");
  L.push("");
  return L.join("\n") + "\n";
}

function build() {
  const corpus = publishedDocFiles(REPO_ROOT).filter((d) => !GENERATED_DOCS.has(d));
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
  const candidates = fs.existsSync(STALENESS_REPORT_PATH)
    ? parseStalenessCandidates(fs.readFileSync(STALENESS_REPORT_PATH, "utf-8"))
    : null;
  return renderReport(computeCoverage(corpus, manifest), candidates);
}

function main() {
  const report = build();
  if (process.argv.includes("--check")) {
    const current = fs.existsSync(OUT_PATH) ? fs.readFileSync(OUT_PATH, "utf-8") : "";
    if (current.trim() !== report.trim()) {
      console.error(
        "[doc-staleness-coverage] report is out of date — run `node scripts/measure-doc-staleness-coverage.mjs` and commit.",
      );
      process.exit(1);
    }
    console.log("[doc-staleness-coverage] report is up to date.");
    return;
  }
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, report);
  console.log(`[doc-staleness-coverage] wrote ${path.relative(REPO_ROOT, OUT_PATH)}.`);
}

if (process.argv[1]?.endsWith("measure-doc-staleness-coverage.mjs")) {
  main();
}
