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
  countVocabularyDrift,
  extractCopySnippets,
  PROSE_AXES,
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
    ["genericLabels", "longSentences", "readability", "textMass", "vocabulary"],
  );
});
