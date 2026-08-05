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
export function computeCoverage(corpus, manifest, mentionsCode = null) {
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

  // Split the uncovered remainder (BI-22207E9A). Without this, "N% covered"
  // reads as N% of a population that could all be covered — and it cannot. A
  // WSID profession doctrine page or a founder-kernel principle names no source
  // file, so no code-edge derivation will ever reach it. Those are not a gap;
  // they are a different kind of document, and counting them as a shortfall
  // argues forever for widening that has already run out.
  let inert = 0;
  if (mentionsCode) {
    for (const doc of corpus) {
      const c = withCode.has(doc);
      const r = withRoute.has(doc);
      if (!c && !r && !mentionsCode.has(doc)) inert++;
    }
  }

  return {
    total,
    covered,
    uncovered: total - covered,
    coveredPct: pct(covered, total),
    /** Uncovered pages that reference no repo file at all — unreachable by design. */
    inert: mentionsCode ? inert : null,
    /** Uncovered pages that DO cite a repo file — the genuinely recoverable set. */
    recoverable: mentionsCode ? total - covered - inert : null,
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
  if (cov.inert !== null) {
    L.push("");
    L.push("### The uncovered remainder is not all a gap");
    L.push("");
    L.push(
      `Of those ${cov.uncovered}, **${cov.inert} reference no repo file anywhere in their text** — no link, no`,
    );
    L.push("backticked path. They are WSID profession doctrine and founder-kernel principle");
    L.push("pages: they describe how to decide, not what the code does. **No code-edge");
    L.push("derivation will ever reach them**, and counting them as a shortfall argues");
    L.push("forever for widening that has already run out.");
    L.push("");
    L.push(
      `The genuinely recoverable set is **${cov.recoverable}** page(s) — those that cite a repo file but`,
    );
    L.push("whose citation the current derivations do not turn into an edge.");
  }
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
  if (cov.inert !== null && cov.recoverable !== null) {
    const addressable = cov.covered + cov.recoverable;
    const addressablePct =
      addressable === 0 ? 0 : Math.round((cov.covered / addressable) * 1000) / 10;
    L.push(
      `1. **Widening is close to exhausted.** Of the pages any code-edge derivation could`,
    );
    L.push(
      `   reach, ${cov.covered} of ${addressable} (${addressablePct}%) now carry an edge. The headline ${cov.coveredPct}% understates`,
    );
    L.push("   the gate because most of what it excludes is doctrine, not undocumented code.");
    L.push("   Further widening buys single-digit page counts; the cheap direction is spent.");
    L.push("2. **Reach is no longer the binding constraint — precision is.** That inverts");
    L.push("   this report's earlier recommendation, and it is the change that makes a");
    L.push("   semantic detector worth designing rather than deferring.");
    L.push("3. **Gate on the addressable corpus, never on the whole.** A gate whose");
    L.push("   denominator includes principle pages will always look broken, and one that");
    L.push("   silently ignores them reports a coverage it does not have — the failure the");
    L.push("   [`gate-coverage-matches-blast-radius`](../founder-kernel/wiki/principles/gate-coverage-matches-blast-radius.md)");
    L.push("   principle names. Say which population is in scope, and measure against it.");
    L.push("4. **Still measure over-report before binding.** Nothing here says the semantic");
    L.push("   signal is accurate — only that it would now have something to look at.");
  } else {
    L.push("Coverage split unavailable — re-run with the corpus scan enabled.");
  }
  L.push("");
  return L.join("\n") + "\n";
}

/** Any citation of a real repo source file — markdown link OR backticked path. */
const ANY_CODE_REF =
  /(?:\]\(\s*|`)([A-Za-z0-9_.\-/]+\.(?:ts|tsx|mts|mjs|js|jsx|prisma|sql|ya?ml|sh|ps1))(?:`|[)\s#])/g;

/**
 * Docs that mention at least one real repo source file.
 *
 * Deliberately LOOSER than the generator's derivations: the question here is
 * "could any edge derivation ever reach this page?", not "does one today". A
 * page that cites a file the generator skipped is recoverable; a page that cites
 * nothing is not.
 */
function docsMentioningCode(corpus) {
  const out = new Set();
  for (const doc of corpus) {
    const text = fs.readFileSync(path.join(REPO_ROOT, doc), "utf-8");
    for (const m of text.matchAll(ANY_CODE_REF)) {
      const rel = m[1];
      if (rel.startsWith("./") || rel.startsWith("../")) {
        out.add(doc);
        break;
      }
      if (fs.existsSync(path.join(REPO_ROOT, rel))) {
        out.add(doc);
        break;
      }
    }
  }
  return out;
}

function build() {
  const corpus = publishedDocFiles(REPO_ROOT).filter((d) => !GENERATED_DOCS.has(d));
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
  const candidates = fs.existsSync(STALENESS_REPORT_PATH)
    ? parseStalenessCandidates(fs.readFileSync(STALENESS_REPORT_PATH, "utf-8"))
    : null;
  const cov = computeCoverage(corpus, manifest, docsMentioningCode(corpus));
  return renderReport(cov, candidates);
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
