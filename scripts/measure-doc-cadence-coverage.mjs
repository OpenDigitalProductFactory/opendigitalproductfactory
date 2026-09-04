#!/usr/bin/env node
// scripts/measure-doc-cadence-coverage.mjs
//
// The documentation cadence contract — MEASURE AND CHECKLIST, not (yet) a gate.
//
// Design: docs/architecture/2026-08-20-assurance-operating-loop-and-capability-completeness.md §4.3
//
// The originating observation: the compliance and licensing-readiness pages
// describe records and screens, but never say what the AI coworker DOES, on what
// cadence, or how it stays current. That is not a compliance-doc problem. It is
// the general shape of every page that documents a surface something automates,
// and it is invisible to the existing doc gates because they check links,
// presence, and freshness — never whether the prose answers the operator's
// actual question.
//
// THE CONTRACT. A page documenting an automated surface should answer five
// things in the operator's language:
//
//   1. acts      — what the coworker actually does (concrete acts, not "can assist")
//   2. cadence   — when it runs, and what triggers an off-cadence run
//   3. currency  — how it stays current: which authority it watches
//   4. boundary  — what it will NOT do, and what escalates to a human
//   5. humanStep — what the human must still do, that no cadence removes
//
// WHY A CHECKLIST AND NOT A GATE (yet). The same reason
// measure-doc-staleness-coverage.mjs measured before gating: turning this on as
// a gate today would fail nearly every page at once, which trains people to skip
// it. What makes the work finishable is knowing the LIST and watching it shrink.
// `--check` verifies the committed checklist is in sync; it asserts no threshold.
//
// HONEST ABOUT ITS OWN LIMITS. Detection is lexical: it looks for the vocabulary
// each element is written in. It can see that a page never mentions a cadence; it
// cannot judge whether a stated cadence is correct. A page can therefore pass a
// row it does not deserve — so a tick here means "the question is answered
// somewhere on the page", never "the answer is right".
//
// Usage:
//   node scripts/measure-doc-cadence-coverage.mjs           # write the checklist
//   node scripts/measure-doc-cadence-coverage.mjs --check   # CI: checklist in sync?
//   node scripts/measure-doc-cadence-coverage.mjs --json    # machine-readable

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const P = (...p) => path.join(REPO_ROOT, ...p);
const OUT_MD = P("docs", "maintenance", "doc-cadence-checklist.md");
const OUT_JSON = P("docs", "maintenance", "doc-cadence-checklist.json");

const SCHEMA_VERSION = "doc-cadence-checklist.v1";

/**
 * Doc areas whose surfaces are automated, and what automates them. Explicit and
 * reviewable rather than inferred: a wrong inference here would demand cadence
 * prose on a page that documents nothing automatic, and the fastest way to make
 * a checklist ignored is to fill it with rows that should not be on it.
 *
 * Seeded from the real automation inventory — the scheduled-job catalog, the
 * coworker self-task registry, and the coworker service catalog. Add an area
 * when automation starts serving it.
 */
export const AUTOMATED_AREAS = {
  compliance: "Regulatory monitor, obligation and control review dates, licence renewal, policy review",
  security: "Patch assessment sweep (OSV/KEV), SIEM correlation, log-signature scan, catalog EOL/EOS",
  "ai-workforce": "Coworker self-tasks, nightly coworker certification, model discovery refresh",
  platform: "Discovery sweeps, estate patch posture, token expiry monitor, runtime janitors",
  operations: "Backlog triage drain, quality-issue drift sweep, MDM data-steward sweep",
  finance: "Recurring invoice generator, capacity drain",
  "build-studio": "Build Studio PR delivery reconcile, sandbox build GC, task-run watchdog",
  storefront: "Marketing scheduler, discovery attribution",
};

/** Lexical signals per contract element. Presence-only — see the header note. */
const SIGNALS = {
  acts: [
    // Verb list widened after a real miss: a page that said "the licensing
    // specialist investigates ..." scored 0 for `acts` while plainly stating
    // what it does. The SUBJECT requirement is kept — the verb must attach to
    // the coworker — so widening the verbs cannot make this fire on generic
    // prose the way the boundary signal once did.
    /\bthe (?:coworker|specialist|agent|watch|sweep) (?:will|does|runs|reviews|checks|drafts|files|proposes|monitors|investigates|summarizes|persists|opens|raises|sweeps|reads)\b/i,
    /\bwhat (?:the|your) (?:coworker|ai coworker|specialist) does\b/i,
    /\bon your behalf\b/i,
  ],
  cadence: [
    /\b(?:daily|weekly|monthly|quarterly|nightly|hourly|annually)\b/i,
    /\bevery (?:day|week|month|quarter|year|\d+)\b/i,
    /\bruns? (?:on a )?(?:schedule|cadence)\b/i,
    /\bhow often\b/i,
    /\bcadence\b/i,
  ],
  currency: [
    /\bstays? (?:current|up to date|on top of)\b/i,
    /\bwatch(?:es|ing)? (?:for|the) (?:change|update|source)/i,
    /\bwhen (?:the )?(?:regulation|rule|source|requirement)s? change\b/i,
    /\bre-?check(?:s|ed|ing)?\b/i,
    /\bauthority (?:source|of record)\b/i,
  ],
  // Tightened deliberately. The first cut matched bare "never" and "cannot",
  // which occur in ordinary prose and scored 54 of 56 pages as answering a
  // question almost none of them answer. An over-reporting checklist says the
  // work is done when it is not — the exact failure this contract exists to
  // catch. These now require the limit to be attributed to the automation or
  // the coworker, so the measure under-reports rather than flatters.
  boundary: [
    /\b(?:coworker|specialist|agent|automation|platform|it) (?:will not|does not|cannot|never)\b/i,
    /\bescalat(?:e|es|ed|ion)\b.{0,60}\b(?:human|owner|operator|approv)/i,
    /\brequires? (?:human|owner|operator|your) (?:approval|review|decision|sign-?off)\b/i,
    /\bdoes not (?:itself )?(?:decide|approve|grant|renew|file|submit|change)\b/i,
    /\bautonomy boundary\b/i,
  ],
  humanStep: [
    /\byou must\b/i,
    /\bwhat you (?:must|need to) do\b/i,
    /\byour responsibility\b/i,
    /\brequires? a (?:human|person|qualified|licensed)\b/i,
    /\b(?:remains?|stays?) (?:a )?(?:human|your) (?:decision|judgement|judgment|call)\b/i,
  ],
};

export const CONTRACT_ELEMENTS = Object.keys(SIGNALS);

export const ELEMENT_LABELS = {
  acts: "What it does",
  cadence: "When it runs",
  currency: "How it stays current",
  boundary: "What it will not do",
  humanStep: "What you must do",
};

/** Parse `area:` out of YAML frontmatter. */
export function frontmatterArea(raw) {
  const m = raw.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const a = m[1].match(/^area:\s*"?([A-Za-z0-9-]+)"?\s*$/m);
  return a ? a[1] : null;
}

/** Which contract elements does this prose answer? Presence-only. */
export function detectElements(body) {
  const found = {};
  for (const [key, patterns] of Object.entries(SIGNALS)) {
    found[key] = patterns.some((re) => re.test(body));
  }
  return found;
}

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (full.endsWith(".md")) acc.push(full);
  }
  return acc;
}

export function measure() {
  const pages = [];
  for (const file of walk(P("docs", "user-guide")).sort()) {
    const raw = fs.readFileSync(file, "utf8");
    const rel = path.relative(REPO_ROOT, file);
    const area = frontmatterArea(raw);
    const automated = area !== null && Object.hasOwn(AUTOMATED_AREAS, area);
    if (!automated) continue;
    const elements = detectElements(raw);
    const answered = CONTRACT_ELEMENTS.filter((k) => elements[k]);
    pages.push({
      path: rel,
      area,
      automation: AUTOMATED_AREAS[area],
      elements,
      answered: answered.length,
      total: CONTRACT_ELEMENTS.length,
      complete: answered.length === CONTRACT_ELEMENTS.length,
    });
  }

  pages.sort((a, b) => a.answered - b.answered || a.path.localeCompare(b.path));

  const byElement = Object.fromEntries(
    CONTRACT_ELEMENTS.map((k) => [k, pages.filter((p) => p.elements[k]).length]),
  );

  return {
    schemaVersion: SCHEMA_VERSION,
    contract: ELEMENT_LABELS,
    automatedAreas: AUTOMATED_AREAS,
    summary: {
      pagesInScope: pages.length,
      complete: pages.filter((p) => p.complete).length,
      byElement,
      note:
        "Detection is lexical and presence-only. A tick means the question is answered somewhere on the page, never that the answer is correct.",
    },
    pages,
  };
}

export function renderMarkdown(r) {
  const L = [];
  L.push("---", 'title: "Documentation Cadence Checklist"', "area: maintenance", "status: active", "---", "");
  L.push("# Documentation Cadence Checklist", "");
  L.push("<!-- GENERATED by scripts/measure-doc-cadence-coverage.mjs — do not edit by hand. -->", "");
  L.push(
    "A page that documents a surface something automates should answer five questions",
    "in the operator's language. This is the worklist for making that true, and it is",
    "ordered worst-first so the next piece of work is always the top row.",
    "",
  );
  L.push("| # | Question |", "|---|---|");
  CONTRACT_ELEMENTS.forEach((k, i) => L.push(`| ${i + 1} | **${ELEMENT_LABELS[k]}** |`));
  L.push("");
  L.push(`> ${r.summary.note}`, "");

  L.push("## Progress", "");
  L.push(`- Pages in scope: **${r.summary.pagesInScope}**`);
  L.push(`- Complete (all five): **${r.summary.complete}**`);
  L.push("");
  L.push("| Question | Pages answering |", "|---|---|");
  for (const k of CONTRACT_ELEMENTS) {
    L.push(`| ${ELEMENT_LABELS[k]} | ${r.summary.byElement[k]} / ${r.summary.pagesInScope} |`);
  }
  L.push("");

  L.push("## Checklist", "");
  for (const p of r.pages) {
    const box = p.complete ? "x" : " ";
    L.push(`- [${box}] \`${p.path}\` — ${p.answered}/${p.total}`);
    const missing = CONTRACT_ELEMENTS.filter((k) => !p.elements[k]).map((k) => ELEMENT_LABELS[k]);
    if (missing.length) L.push(`  - missing: ${missing.join(" · ")}`);
  }
  L.push("");

  L.push("## Areas in scope, and what automates them", "");
  L.push("| Area | Automation |", "|---|---|");
  for (const [area, automation] of Object.entries(r.automatedAreas)) {
    L.push(`| \`${area}\` | ${automation} |`);
  }
  L.push("");
  return L.join("\n") + "\n";
}

function main() {
  const args = new Set(process.argv.slice(2));
  const report = measure();
  const json = JSON.stringify(report, null, 2) + "\n";
  const md = renderMarkdown(report);

  if (args.has("--json")) {
    process.stdout.write(json);
    return;
  }
  if (args.has("--check")) {
    const drift = [];
    for (const [f, want] of [[OUT_JSON, json], [OUT_MD, md]]) {
      const have = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null;
      if (have !== want) drift.push(path.relative(REPO_ROOT, f));
    }
    if (drift.length) {
      console.error("Doc-cadence checklist is out of sync:");
      for (const f of drift) console.error(`  - ${f}`);
      console.error("\nRegenerate with: node scripts/measure-doc-cadence-coverage.mjs");
      process.exit(1);
    }
    console.log("Doc-cadence checklist is in sync.");
    return;
  }

  fs.mkdirSync(path.dirname(OUT_MD), { recursive: true });
  fs.writeFileSync(OUT_JSON, json);
  fs.writeFileSync(OUT_MD, md);
  const s = report.summary;
  console.log(`Doc cadence contract: ${s.complete}/${s.pagesInScope} pages answer all five questions.`);
  for (const k of CONTRACT_ELEMENTS) {
    console.log(`  ${ELEMENT_LABELS[k].padEnd(24)} ${s.byElement[k]}/${s.pagesInScope}`);
  }
  console.log(`\nWrote ${path.relative(REPO_ROOT, OUT_MD)}`);
}

if (process.argv[1]?.endsWith("measure-doc-cadence-coverage.mjs")) {
  main();
}
