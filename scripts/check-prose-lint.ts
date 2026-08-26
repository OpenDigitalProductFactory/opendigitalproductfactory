#!/usr/bin/env tsx
// Prose lint guard — BI-88D8C725 (EP-UX-SYSTEM §6 L4 / §8.1 D6).
//
// The BI asked for Vale (vale.sh) with a DPF rule pack over UI copy. Vale's
// rule engine is YAML + Tengo scripts — it cannot import a TypeScript
// function, only reimplement its logic in a different language. Three of the
// four rules below are explicitly required to REUSE existing runtime
// signals (resolveVocabularyKey's terms, countGenericDecisionLabels,
// the lib/readability/ Flesch-Kincaid policy) rather than reinvent them, and
// reimplementing them in Tengo would fork the logic and let lint-time and
// runtime drift apart. So this ships as the check-style-drift.mjs-shaped
// Node/TS ratchet the BI names as the fallback, with the rationale being
// "no Tengo access to real TS reuse" rather than "no network for the
// binary" (network to both github.com and registry.npmjs.org was reachable
// when this was built). See the PR description for the full tradeoff.
//
// Rules encoded (all operate on UI copy extracted from source, not rendered
// HTML — L4 answers before a PR opens, the rendered sweep stays binding):
//   1. vocabulary    — a hardcoded archetype-specific stakeholder/portal term
//                       (the exact strings getVocabulary()/resolveVocabularyKey
//                       resolve to) appearing in a generic surface instead of
//                       being resolved through the vocabulary system.
//   2. genericLabels — countGenericDecisionLabels (owner-first/ux-audit.ts),
//                       reused unmodified, applied directly to source text
//                       instead of rendered HTML.
//   3. readability   — lib/readability/'s Flesch-Kincaid grade, reused
//                       unmodified, wired (it was built but unwired) against
//                       marketing/storefront copy strings.
//   4. longSentences / textMass — sentence-length and per-file prose-mass
//                       heuristics; nothing upstream penalizes text mass
//                       (the motivating gap named in the BI body).
//
// Same ratchet contract as check-style-drift.mjs: a per-file, per-axis
// baseline that may shrink but never grow. Pre-existing violations are not
// failed; a PR that adds a NEW violating file, or grows an axis beyond its
// baseline count, fails.
//
//   tsx scripts/check-prose-lint.ts            # check (CI)
//   tsx scripts/check-prose-lint.ts --update   # regenerate the baseline

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, relative } from "node:path";

import { getVocabulary } from "../apps/web/lib/storefront/archetype-vocabulary";
import { INDUSTRY_SLUGS } from "../apps/web/lib/storefront/industries";
import { countGenericDecisionLabels } from "../apps/web/lib/owner-first/ux-audit";
import {
  analyzeReadability,
  withinReadingLevel,
} from "../packages/validators/src/readability";
import { isProseLintSource, isRetiredVocabSource } from "./lib/gate-sensitivity.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(REPO_ROOT, "apps", "web");
// lib/ is scanned too: the attention-signal copy an operator reads on
// /build/work is built in lib/portal-context/work-resolver.ts, not in a
// component, so an app+components-only sweep could not see it (BI-D6BC8C18).
const SCAN_DIRS = ["app", "components", "lib"].map((d) => join(WEB, d));
const BASELINE_PATH = join(REPO_ROOT, "scripts", "prose-lint-baseline.json");

// ─── Rule 1: archetype vocabulary conformance ───────────────────────────────
//
// Reuses getVocabulary() (the function resolveVocabularyKey's result feeds
// into) rather than re-listing terms: for every known industry slug, pull its
// stakeholder/portal labels and keep only the ones that differ from the
// neutral default (getVocabulary(null) — DEFAULT_VOCABULARY is not exported,
// so this reads it the same way call sites do: an unresolved category).
// A UI-copy string outside the vocabulary system that hardcodes one of these
// (e.g. "Guests", "Patient Portal") should instead resolve it via
// getVocabulary(resolveVocabularyKey(...)) so the surface adapts per archetype.
export function buildArchetypeTerms(): Array<{ term: string; category: string }> {
  const neutral = getVocabulary(null);
  const seen = new Map<string, string>();
  for (const slug of INDUSTRY_SLUGS) {
    const vocab = getVocabulary(slug);
    for (const field of ["stakeholderLabel", "portalLabel"] as const) {
      const term = vocab[field];
      if (!term || term === neutral[field]) continue;
      if (!seen.has(term)) seen.set(term, slug);
    }
  }
  return [...seen.entries()].map(([term, category]) => ({ term, category }));
}

const ARCHETYPE_TERMS = buildArchetypeTerms();

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Count hardcoded archetype-vocabulary terms across a set of copy snippets. */
export function countVocabularyDrift(snippets: string[]): number {
  if (snippets.length === 0) return 0;
  const joined = snippets.join("\n");
  let count = 0;
  for (const { term } of ARCHETYPE_TERMS) {
    const re = new RegExp(`\\b${escapeRegExp(term)}\\b`, "g");
    count += (joined.match(re) || []).length;
  }
  return count;
}

// ─── Rule 5: retired vocabulary ─────────────────────────────────────────────
//
// BI-D6BC8C18. A term the platform has RENAMED must not survive in owner-facing
// copy. Phases 1-4 of the Workroom rename (BI-D2D190BF) moved the model, the
// view types, the MCP tools and the doctrine, but seven UI strings kept saying
// "capsule" because no gate could see them — docs/architecture/workroom-
// vocabulary-boundary.md lists what is deliberately unrenamed, and UI copy was
// never on that list. This axis is the mechanical half of that boundary doc.
//
// Scope is COPY ONLY. Internal identifiers keep their names until the item that
// owns them lands: capsuleId, WC-* keys, workCapsuleId FKs, the work_capsule_*
// grant names and @/lib/work-capsules import paths are BI-496CD36E's, not this
// guard's. Extraction only sees JSX text and copy-bearing props, so an
// identifier is out of reach by construction rather than by an exclusion list.
//
// Adding a term here is how a rename becomes enforceable: land the copy change
// and the registry row in the same PR, and the old word cannot come back.
export const RETIRED_TERMS: Array<{ term: RegExp; retired: string; use: string; owner: string }> = [
  { term: /\bwork\s+capsules?\b|\bcapsules?\b/gi, retired: "capsule", use: "workroom", owner: "BI-D6BC8C18" },
];

/** Count retired owner-facing terms across a set of copy snippets. */
export function countRetiredVocabulary(snippets: string[]): number {
  if (snippets.length === 0) return 0;
  const joined = snippets.join("\n");
  let count = 0;
  for (const { term } of RETIRED_TERMS) {
    term.lastIndex = 0;
    count += (joined.match(term) || []).length;
  }
  return count;
}

// ─── Copy extraction ─────────────────────────────────────────────────────────
//
// Not a full JSX/AST parse (check-style-drift.mjs sets that precedent — a
// regex pass over source text is the established complexity budget for these
// guards). Two shapes cover almost all DPF UI copy: JSX text nodes, and
// quoted values assigned to copy-bearing props/keys.
// BI-F45A2AE2: the closing delimiter must open a REAL tag (`</` or `<Name`),
// not a generic's type argument. On its own this is not enough — `useState<T>`
// is followed by a letter too — so `looksLikeCode` below carries the rest.
const JSX_TEXT_RE = />\s*([^<>{}\n][^<>{}]*?)\s*<[/A-Za-z]/g;
const ATTR_COPY_RE =
  /\b(?:label|title|placeholder|alt|aria-label|description|heading|subheading|subtitle|helperText|helpText|summary|message|tooltip)\s*[:=]\s*(["'`])((?:(?!\1)[^\\]|\\.)*)\1/g;

/**
 * Source that the JSX-text regex captured by accident (BI-F45A2AE2).
 *
 * `/>...</` matches everything between a `>` and the next `<`, which includes
 * the code between two generic calls: the span from the `>` closing
 * `useState<Mode>` to the `<` opening `useState<{ ok: boolean }>` is captured
 * verbatim and scored as prose. A component carrying ZERO copy measured
 * textMass +23 that way, and the only exits were contorting the component or
 * `--update`, which bakes the false count into everyone's baseline.
 *
 * Each signal below is code-only. UI copy may contain parentheses and colons,
 * so those alone are never enough; a statement separator, an arrow, a
 * declaration keyword or a leading close-paren is.
 */
function looksLikeCode(s: string): boolean {
  if (/=>/.test(s)) return true;
  if (/^\s*[)\]]/.test(s)) return true; // a JSX text node never opens with a closer
  if (/;\s*(\n|$)/.test(s)) return true; // a statement ended inside the span
  if (/\b(const|let|var|function|return|await|import|export\s+(async|function|const|type))\b/.test(s)) {
    return true;
  }
  if (/\b(useState|useEffect|useMemo|useCallback|useRef|useTransition)\s*\(/.test(s)) return true;
  return false;
}

function looksLikeCopy(s: string): boolean {
  if (looksLikeCode(s)) return false;
  if (s.length < 8) return false;
  if (!/[a-zA-Z]{3}/.test(s)) return false;
  if (!/\s/.test(s)) return false; // require at least two words
  if (s.startsWith("//") || s.startsWith("/*") || s.startsWith("*")) return false;
  if (/^[A-Za-z0-9_.,:/-]+$/.test(s) === false) {
    // contains characters outside a plausible-prose set (JSX expressions,
    // template interpolation, stray braces that slipped past the outer regex)
    if (/[{}<>`]/.test(s)) return false;
  }
  if (/^[A-Za-z0-9_-]+$/.test(s)) return false; // single token / className-ish
  return true;
}

/** Extract candidate UI-copy strings from a source file's raw text. */
export function extractCopySnippets(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(JSX_TEXT_RE)) {
    const s = m[1].trim();
    if (looksLikeCopy(s)) out.push(s);
  }
  for (const m of text.matchAll(ATTR_COPY_RE)) {
    const s = m[2].trim();
    if (looksLikeCopy(s)) out.push(s);
  }
  return out;
}

// Widened attribute set, used ONLY by the retired-vocabulary axis.
//
// The four original axes are word-count/readability ratchets whose baselines
// are calibrated against ATTR_COPY_RE's reach; widening that regex globally
// re-scored ~40 unrelated files on textMass alone. A renamed term, though,
// has to be caught wherever an operator can read it — "Open capsule" shipped
// as an `actionLabel`, which the bare-prop, case-sensitive alternation cannot
// see. So the wider net is scoped to the axis that needs it (BI-D6BC8C18).
const ATTR_COPY_WIDE_RE =
  /\b[a-z]*(?:label|title|placeholder|alt|aria-label|description|heading|subheading|subtitle|helperText|helpText|summary|message|tooltip|text|copy)\s*[:=]\s*(["'`])((?:(?!\1)[^\\]|\\.)*)\1/gi;

/** Copy snippets for the retired-vocabulary axis: JSX text plus camelCase props. */
export function extractCopySnippetsWide(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(JSX_TEXT_RE)) {
    const s = m[1].trim();
    if (looksLikeCopy(s)) out.push(s);
  }
  for (const m of text.matchAll(ATTR_COPY_WIDE_RE)) {
    const s = m[2].trim();
    if (looksLikeCopy(s)) out.push(s);
  }
  return out;
}

function splitSentences(s: string): string[] {
  return s
    .split(/[.!?]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

/** Sentences over this length lose readers; matches the platform copy guidance
 *  (docs/platform-usability-standards.md -> short sentences, active voice). */
const LONG_SENTENCE_WORDS = 25;

/** Only score sentence-shaped copy for readability/length — short labels and
 *  button text are not prose and would just add noise. */
const MIN_PROSE_WORDS = 6;

/** Marketing/storefront copy is customer-facing (mirrors the substring test
 *  in lib/readability/policy.ts's isExternalCopyRoute — same audience split). */
function isExternalCopyPath(relPath: string): boolean {
  const p = relPath.toLowerCase();
  return p.includes("/storefront/") || p.includes("/marketing/");
}

export type ProseAxes = {
  vocabulary: number;
  retiredVocabulary: number;
  genericLabels: number;
  readability: number;
  longSentences: number;
  textMass: number;
};

export const PROSE_AXES: (keyof ProseAxes)[] = [
  "vocabulary",
  "retiredVocabulary",
  "genericLabels",
  "readability",
  "longSentences",
  "textMass",
];

/** Score one file's raw source text against all four rule families. */
export function analyzeFile(relPath: string, text: string): ProseAxes {
  const snippets = extractCopySnippets(text);

  let readability = 0;
  let longSentences = 0;
  let textMass = 0;
  const external = isExternalCopyPath(relPath);

  for (const snippet of snippets) {
    textMass += wordCount(snippet);
    for (const sentence of splitSentences(snippet)) {
      const words = wordCount(sentence);
      if (words > LONG_SENTENCE_WORDS) longSentences += 1;
      if (external && words >= MIN_PROSE_WORDS) {
        const { gradeLevel } = analyzeReadability(sentence);
        if (!withinReadingLevel(gradeLevel, "high-school")) readability += 1;
      }
    }
  }

  return {
    vocabulary: countVocabularyDrift(snippets),
    retiredVocabulary: countRetiredVocabulary(extractCopySnippetsWide(text)),
    genericLabels: countGenericDecisionLabels(text),
    readability,
    longSentences,
    textMass,
  };
}

/** Axes for a file in scope for the retired-vocabulary rule only. */
export function retiredVocabOnly(text: string): ProseAxes {
  return {
    vocabulary: 0,
    retiredVocabulary: countRetiredVocabulary(extractCopySnippetsWide(text)),
    genericLabels: 0,
    readability: 0,
    longSentences: 0,
    textMass: 0,
  };
}

function isZero(axes: ProseAxes): boolean {
  return PROSE_AXES.every((a) => axes[a] === 0);
}

// ─── File discovery (mirrors check-style-drift.mjs's listSourceFiles) ──────
function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".next" || entry === "dist" || entry === ".turbo") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

function scan(): Record<string, ProseAxes> {
  const counts: Record<string, ProseAxes> = {};
  for (const dir of SCAN_DIRS) {
    for (const file of listSourceFiles(dir)) {
      const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
      const fullScope = isProseLintSource(rel);
      if (!fullScope && !isRetiredVocabSource(rel)) continue;
      const text = readFileSync(file, "utf8");
      // A lib/ file is in scope for the retired-vocabulary axis only. Scoring
      // it on textMass/readability too would import a few thousand words of
      // new baseline for an axis calibrated against app+components.
      const axes = fullScope ? analyzeFile(rel, text) : retiredVocabOnly(text);
      if (!isZero(axes)) counts[rel] = axes;
    }
  }
  return counts;
}

type RatchetResult = { newFiles: string[]; increased: string[] };

/** Ratchet comparison, same shape as check-style-drift.mjs's compareTokens(). */
export function compareProse(
  counts: Record<string, ProseAxes>,
  baseline: Record<string, Partial<ProseAxes>>,
): RatchetResult {
  const newFiles: string[] = [];
  const increased: string[] = [];
  for (const [file, axes] of Object.entries(counts)) {
    const prior = baseline[file];
    if (!prior) {
      const summary = PROSE_AXES.filter((a) => axes[a] > 0)
        .map((a) => `${a} +${axes[a]}`)
        .join(", ");
      newFiles.push(`${file} (${summary})`);
      continue;
    }
    const grown = PROSE_AXES.filter((a) => axes[a] > (prior[a] ?? 0));
    if (grown.length) {
      const summary = grown.map((a) => `${a} ${prior[a] ?? 0} -> ${axes[a]}`).join(", ");
      increased.push(`${file} (${summary})`);
    }
  }
  return { newFiles, increased };
}

function main() {
  const counts = scan();

  if (process.argv.includes("--update")) {
    const sorted: Record<string, ProseAxes> = Object.fromEntries(
      Object.keys(counts)
        .sort()
        .map((k) => [k, counts[k]]),
    );
    writeFileSync(BASELINE_PATH, `${JSON.stringify(sorted, null, 2)}\n`);
    console.log(`Wrote prose-lint baseline: ${Object.keys(sorted).length} files with a signal.`);
    process.exit(0);
  }

  let baseline: Record<string, Partial<ProseAxes>> = {};
  try {
    baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    console.error(
      `Missing baseline ${relative(REPO_ROOT, BASELINE_PATH)} — run: tsx scripts/check-prose-lint.ts --update`,
    );
    process.exit(1);
  }

  const { newFiles, increased } = compareProse(counts, baseline);

  if (newFiles.length > 0 || increased.length > 0) {
    console.error("Prose lint — new or grown UI-copy issues (EP-UX-SYSTEM L4, BI-88D8C725).\n");
    console.error("Axes: vocabulary (hardcoded archetype term — use getVocabulary()/resolveVocabularyKey),");
    console.error("      retiredVocabulary (a RENAMED term in owner-facing copy — see RETIRED_TERMS for the replacement),");
    console.error("      genericLabels (owner-first/ux-audit.ts GENERIC_DECISION_LABELS in source),");
    console.error("      readability (marketing/storefront copy over the high-school Flesch-Kincaid grade),");
    console.error("      longSentences (a sentence over 25 words), textMass (total UI-copy word count).\n");
    if (newFiles.length) {
      console.error("New files with a signal:");
      for (const f of newFiles) console.error(`  - ${f}`);
    }
    if (increased.length) {
      console.error("More signal than the baseline:");
      for (const f of increased) console.error(`  - ${f}`);
    }
    console.error("\nIf you intentionally improved a file, run --update to retighten the baseline.");
    process.exit(1);
  }

  const totals = PROSE_AXES.map(
    (a) => `${Object.values(baseline).reduce((s, f) => s + (f[a] ?? 0), 0)} ${a}`,
  ).join(" / ");
  console.log(
    `Prose lint OK — no new or grown UI-copy issues. Baseline: ${Object.keys(baseline).length} files / ${totals} (migrate as touched).`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
