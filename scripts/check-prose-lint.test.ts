/**
 * BI-88D8C725 — tests for the prose-lint guard's four rule families.
 *
 * Same convention as check-style-drift.test.mjs (node:test, pure functions
 * imported directly, no fixture files on disk): a "known-bad" source snippet
 * that trips each rule, and a "known-good" one that doesn't.
 *
 * Run: tsx --test scripts/check-prose-lint.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  analyzeFile,
  buildArchetypeTerms,
  compareProse,
  countRetiredVocabulary,
  countVocabularyDrift,
  extractCopySnippets,
  extractCopySnippetsWide,
  PROSE_AXES,
  retiredVocabOnly,
} from "./check-prose-lint";

// ─── Rule 1: archetype vocabulary conformance ───────────────────────────────

test("archetype terms are pulled from getVocabulary(), not reinvented, and exclude the neutral default", () => {
  const terms = buildArchetypeTerms().map((t) => t.term);
  assert.ok(terms.includes("Guests"), "food-hospitality stakeholderLabel should be present");
  assert.ok(terms.includes("Venue Portal"), "food-hospitality portalLabel should be present");
  assert.ok(terms.includes("Patient Portal"), "healthcare-wellness portalLabel should be present");
  // The neutral default ("Contacts" / "Portal") is not archetype-specific —
  // it must not appear as a flaggable term.
  assert.ok(!terms.includes("Contacts"));
  assert.ok(!terms.includes("Portal"));
});

test("a hardcoded archetype term outside the vocabulary system is flagged (known-bad)", () => {
  const badCopy = ["Welcome back — here's what your Guests booked this week."];
  assert.equal(countVocabularyDrift(badCopy), 1);
});

test("copy that carries no archetype-specific noun is clean (known-good)", () => {
  const goodCopy = ["Welcome back — here's what your customers booked this week."];
  assert.equal(countVocabularyDrift(goodCopy), 0);
});

// ─── Rule 2: banned generic decision labels, applied at source ─────────────

test("a generic decision label in JSX text is caught at source (known-bad)", () => {
  const badSource = `export function Panel() {
    return <button>Make this business decision?</button>;
  }`;
  assert.equal(analyzeFile("apps/web/components/Panel.tsx", badSource).genericLabels, 1);
});

test("a specific, owner-first decision label passes (known-good)", () => {
  const goodSource = `export function Panel() {
    return <button>Approve the $420 catering invoice?</button>;
  }`;
  assert.equal(analyzeFile("apps/web/components/Panel.tsx", goodSource).genericLabels, 0);
});

// ─── Rule 3: readability tier (wires the previously-unwired FK policy) ─────

test("marketing copy above the high-school Flesch-Kincaid grade is flagged (known-bad)", () => {
  const badSource = `export function Hero() {
    return <p title="Leveraging our omnichannel infrastructure substantially optimizes stakeholder-facing conversion throughput across heterogeneous acquisition funnels.">x</p>;
  }`;
  const axes = analyzeFile("apps/web/app/(shell)/marketing/hero.tsx", badSource);
  assert.ok(axes.readability >= 1, "long, jargon-dense sentence should exceed the high-school grade cap");
});

test("plain-language marketing copy at a high-school reading level passes (known-good)", () => {
  const goodSource = `export function Hero() {
    return <p title="We help you book more guests with less work.">x</p>;
  }`;
  const axes = analyzeFile("apps/web/app/(shell)/marketing/hero.tsx", goodSource);
  assert.equal(axes.readability, 0);
});

test("readability is only scored on marketing/storefront paths, not internal surfaces", () => {
  const badSource = `export function Hero() {
    return <p title="Leveraging our omnichannel infrastructure substantially optimizes stakeholder-facing conversion throughput across heterogeneous acquisition funnels.">x</p>;
  }`;
  const axes = analyzeFile("apps/web/app/(shell)/admin/internal.tsx", badSource);
  assert.equal(axes.readability, 0);
});

// ─── Rule 4: sentence length / text mass ────────────────────────────────────

test("a sentence over 25 words is flagged as long (known-bad)", () => {
  const badCopy = [
    "This is a very long sentence that keeps going and going and going without ever stopping to give the reader a single moment of rest or clarity at all.",
  ];
  const axes = analyzeFile("apps/web/components/x.tsx", `<p>${badCopy[0]}</p>`);
  assert.equal(axes.longSentences, 1);
});

test("a short, plain sentence is not flagged (known-good)", () => {
  const axes = analyzeFile("apps/web/components/x.tsx", "<p>Check your inbox for new messages.</p>");
  assert.equal(axes.longSentences, 0);
});

test("extractCopySnippets ignores className-shaped tokens and JSX expressions", () => {
  const src = `<div className="flex items-center gap-dpf-md">{count}</div>`;
  assert.deepEqual(extractCopySnippets(src), []);
});

// ─── Ratchet shape (mirrors check-style-drift.mjs's compareTokens contract) ─

test("compareProse only fails on a NEW file or a GROWN axis, never on a stable baseline count", () => {
  const counts = { "a.tsx": { vocabulary: 2, genericLabels: 0, readability: 0, longSentences: 0, textMass: 40 } };
  const baseline = { "a.tsx": { vocabulary: 2, genericLabels: 0, readability: 0, longSentences: 0, textMass: 40 } };
  const result = compareProse(counts, baseline);
  assert.deepEqual(result, { newFiles: [], increased: [] });
});

test("compareProse flags a file whose axis count grew past its baseline", () => {
  const counts = { "a.tsx": { vocabulary: 3, genericLabels: 0, readability: 0, longSentences: 0, textMass: 40 } };
  const baseline = { "a.tsx": { vocabulary: 2, genericLabels: 0, readability: 0, longSentences: 0, textMass: 40 } };
  const result = compareProse(counts, baseline);
  assert.equal(result.newFiles.length, 0);
  assert.equal(result.increased.length, 1);
  assert.match(result.increased[0], /vocabulary 2 -> 3/);
});

test("compareProse flags a file with a signal that has no baseline entry at all", () => {
  const counts = { "new.tsx": { vocabulary: 0, genericLabels: 1, readability: 0, longSentences: 0, textMass: 5 } };
  const result = compareProse(counts, {});
  assert.equal(result.newFiles.length, 1);
  assert.equal(result.increased.length, 0);
});

test("every declared axis is covered by PROSE_AXES", () => {
  assert.deepEqual(
    [...PROSE_AXES].sort(),
    [
      "genericLabels",
      "longSentences",
      "readability",
      "retiredVocabulary",
      "textMass",
      "vocabulary",
    ],
  );
});

// ─── Rule 5: retired vocabulary (BI-D6BC8C18) ───────────────────────────────

test("retiredVocabulary catches a renamed term in JSX text", () => {
  const bad = `<p>No active capsules yet.</p>`;
  assert.equal(countRetiredVocabulary(extractCopySnippetsWide(bad)), 1);
});

test("retiredVocabulary catches the exact regression that shipped — a camelCase actionLabel", () => {
  // The literal defect: apps/web/lib/portal-context/work-resolver.ts built the
  // lease-expired attention card with actionLabel: "Open capsule". The original
  // bare-prop, case-sensitive ATTR_COPY_RE could not see it, which is why four
  // shipped phases of the rename left it standing.
  const bad = `attention.push({ actionLabel: "Open capsule", actionHref: href });`;
  assert.equal(countRetiredVocabulary(extractCopySnippetsWide(bad)), 1);
});

test("retiredVocabulary counts every occurrence, singular and plural", () => {
  const bad = `<p>Work capsules and one capsule: the capsule is the unit.</p>`;
  assert.equal(countRetiredVocabulary(extractCopySnippetsWide(bad)), 3);
});

test("retiredVocabulary is clean once the copy says workroom", () => {
  const good = `<p>No active workrooms yet.</p>`;
  assert.equal(countRetiredVocabulary(extractCopySnippetsWide(good)), 0);
});

test("retiredVocabulary does not fire on internal identifiers", () => {
  // capsuleId / WC-* keys / workCapsuleId FKs / work_capsule_* grants belong to
  // BI-496CD36E and must survive this guard untouched. Extraction only reaches
  // JSX text and copy-bearing props, so an identifier is out of scope by
  // construction rather than by an exclusion list.
  const identifiers = [
    `const capsuleId = stringParam(params, "capsuleId");`,
    `import { recordWorkroomEvidence } from "@/lib/work-capsules/work-capsule-store";`,
    `list_workrooms: ["work_capsule_read"],`,
    `if (capsule) anchors.push({ kind: "capsule", id: capsule.capsuleId });`,
  ].join("\n");
  assert.equal(countRetiredVocabulary(extractCopySnippetsWide(identifiers)), 0);
});

test("the regex is stateful-safe — repeated calls do not skip matches", () => {
  // RETIRED_TERMS entries carry the /g flag, so a shared lastIndex would make
  // every second call under-count. The counter resets it; this pins that.
  const bad = extractCopySnippetsWide(`<p>No active capsules yet.</p>`);
  assert.equal(countRetiredVocabulary(bad), 1);
  assert.equal(countRetiredVocabulary(bad), 1);
  assert.equal(countRetiredVocabulary(bad), 1);
});

test("retiredVocabOnly scores lib files on the rename axis alone", () => {
  // lib/ is in scope for this axis only; scoring it on textMass would import
  // thousands of words of baseline for an axis calibrated on app+components.
  const axes = retiredVocabOnly(`<p>A long sentence about capsules and other things entirely.</p>`);
  assert.equal(axes.retiredVocabulary, 1);
  assert.equal(axes.textMass, 0);
  assert.equal(axes.longSentences, 0);
});

// BI-F45A2AE2. `/>...</` captures everything between a `>` and the next `<`,
// which includes the code between two generic calls — so a component carrying
// no copy at all scored textMass. The only exits were contorting the component
// or `--update`, which bakes a false count into everyone's baseline.
test("the span between two generics is code, not UI copy", () => {
  const source = [
    'const [mode, setMode] = useState<Mode>("idle");',
    '  const [text, setText] = useState(proposal.draftText ?? "");',
    "  const [result, setResult] = useState<{ ok: boolean }>(null);",
  ].join("\n");
  assert.deepEqual(extractCopySnippets(source), []);
  assert.equal(analyzeFile("apps/web/components/Example.tsx", source).textMass, 0);
});

test("a type alias followed by a Promise generic is code, not UI copy", () => {
  const source = [
    "export type RuleResult = ActionResult<string>;",
    "",
    "export async function rule(input: RuleInput): Promise<RuleResult> {",
  ].join("\n");
  assert.deepEqual(extractCopySnippets(source), []);
});

test("a JSX ternary fragment is code, not UI copy", () => {
  const source = "      ) : proposal.agreementNote ? (\n        <p>{proposal.agreementNote}</p>";
  assert.deepEqual(extractCopySnippets(source), []);
});

test("real copy still counts, including copy that contains parentheses", () => {
  assert.deepEqual(
    extractCopySnippets("<p>Answer in your own words — it is saved as a draft for you to review.</p>"),
    ["Answer in your own words — it is saved as a draft for you to review."],
  );
  assert.deepEqual(
    extractCopySnippets("<span>Your coworkers were only moderately sure (worth a read).</span>"),
    ["Your coworkers were only moderately sure (worth a read)."],
  );
});
