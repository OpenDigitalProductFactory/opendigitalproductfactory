// Self-test for check-rendered-backlog-pointers.mjs (BI-5BF97BAA).
//
// A guard that cannot fail is worse than no guard, because it reads as coverage.
// This proves four things: it catches each shape of the real defect, it stays
// quiet on the shapes that are correct as they are, the stated exemption works,
// and the checked-in tree is clean.
//
// The precision cases are not padding. Two earlier drafts of this guard reported
// 584 and then 9 findings that were all legitimate — provenance ids in comments,
// then backlog ids read from a query — so the quiet cases below are the ones
// that keep the guard honest enough to leave switched on.

import assert from "node:assert/strict";
import { test } from "node:test";

import { findViolations, scan } from "./check-rendered-backlog-pointers.mjs";

function rendering(text) {
  return findViolations({ file: "apps/web/components/Example.tsx", text, rendering: true });
}

function library(text) {
  return findViolations({ file: "apps/web/lib/example.ts", text, rendering: false });
}

function rules(findings) {
  return findings.map((finding) => finding.rule);
}

test("catches a backlog id frozen into a next-step field", () => {
  // The exact shape of all seventeen references, post-rename.
  assert.deepEqual(rules(library('    nextStep: "BI-4025EF5F",')), ["no-hardcoded-declaration"]);
  // The hand-authored format that never matched the rest of the backlog.
  assert.deepEqual(rules(library('    nextStep: "BI-INT-8D4F72",')), ["no-hardcoded-declaration"]);
});

test("catches the retired field wherever it appears", () => {
  assert.ok(rules(library('  nextBacklogItemId: "BI-4025EF5F",')).includes("no-legacy-field"));
  assert.ok(rules(library("  nextBacklogItemId: string;")).includes("no-legacy-field"));
});

test("catches reaching past the resolver for the raw item id", () => {
  assert.deepEqual(rules(rendering("      <p>{row.nextStep.itemId}</p>")), ["no-raw-render"]);
});

test("catches a backlog id hardcoded into copy a reader sees", () => {
  assert.deepEqual(rules(rendering('      <MetricPill label="Backlog" value="BI-4025EF5F" />')), [
    "no-raw-render",
  ]);
  assert.deepEqual(rules(rendering("      <span>BI-INT-8D4F72</span>")), ["no-raw-render"]);
});

test("stays quiet on the resolved shape", () => {
  assert.deepEqual(rendering("      <p>{coverageNextSteps[rowIndex].label}</p>"), []);
  assert.deepEqual(rendering("      <p>{boundary.nextStep.label}</p>"), []);
  assert.deepEqual(
    rendering('      {nextStep?.kind === "filed" && <MetricPill label="Backlog" value={nextStep.label} />}'),
    [],
  );
});

test("stays quiet on a declared pointer that states intent", () => {
  assert.deepEqual(library('    nextStep: openIntent("Entity links before write-back"),'), []);
});

// PRECISION — the cases an over-reporting draft got wrong.
test("a backlog id read from a query is not a finding", () => {
  // These resolve by construction: the row came from the backlog itself.
  assert.deepEqual(rendering("      <span>{escalation.backlogItemId}</span>"), []);
  assert.deepEqual(rendering("      {need.linkedBacklogItemId ? <Chip>{need.linkedBacklogItemId}</Chip> : null}"), []);
});

test("a backlog id in a provenance field is not a finding", () => {
  // Backward-looking: which item justified this contract. Stays true after the
  // item is archived, unlike a forward-looking next step.
  assert.deepEqual(library('    reviewRef: "BI-3023912F",'), []);
  assert.deepEqual(library('    ratifiedBy: { role: "owner", ref: "BI-7626A660" },'), []);
});

test("a backlog id named in a comment is not a finding", () => {
  assert.deepEqual(library("// Fixed under BI-5BF97BAA."), []);
  assert.deepEqual(rendering("  // Renders the resolved label (BI-5BF97BAA)."), []);
  assert.deepEqual(library("/* nextStep: \"BI-4025EF5F\" was the old shape. */"), []);
});

test("honours a stated exemption on the line and the line above", () => {
  assert.deepEqual(
    rendering('      <span>BI-4025EF5F</span> {/* rendered-backlog-pointer: allow fixture copy */}'),
    [],
  );
  assert.deepEqual(
    rendering("      {/* rendered-backlog-pointer: allow fixture copy */}\n      <span>BI-4025EF5F</span>"),
    [],
  );
});

test("the checked-in tree passes", () => {
  const findings = scan();
  assert.deepEqual(
    findings,
    [],
    `unexpected findings:\n${findings.map((f) => `  ${f.file}:${f.line} ${f.detail}`).join("\n")}`,
  );
});
