// scripts/check-authoring-cost-dimensions.test.mjs
//
// BI-7CE5E772. The parsers are the interesting part: both read prose that will
// keep being edited, so each test pins a way the parse could quietly go wrong
// and start reporting a false agreement.

import assert from "node:assert/strict";
import test from "node:test";

import {
  parseCostDimensionsFromTaxonomy,
  parseCostDimensionsFromAuthoring,
  compareCostDimensions,
} from "./check-authoring-cost-dimensions.mjs";

test("reads the registry members and not the dimensions its comments mention", () => {
  // The real block is heavily annotated, and those comments name other
  // dimensions. Reading a comment as a member is the false-agreement path.
  const source = `
export const PRINCIPLE_COST_DIMENSIONS = [
  "blast_radius",
  "human_cognitive_load",
  // "reversibility" is a BENEFIT and intentionally stays out of this list.
  "vendor_lock_in",
  // EP-SOVEREIGN-SOC: same treatment as "blast_radius" above.
  "business_disruption",
  "operator_effort",
] as const;
`;

  assert.deepEqual(parseCostDimensionsFromTaxonomy(source), [
    "blast_radius",
    "human_cognitive_load",
    "vendor_lock_in",
    "business_disruption",
    "operator_effort",
  ]);
});

test("reads only the enumerating sentence, not a later prose mention", () => {
  const source = [
    "   - **Cost axes must be negative.** Five dimensions are costs — the exact set is",
    "`PRINCIPLE_COST_DIMENSIONS` in wiki-taxonomy.ts, and at the time of writing it is",
    "`blast_radius`, `human_cognitive_load`, `vendor_lock_in`, `business_disruption`,",
    "`operator_effort`. Read the registry rather than trusting this list: it is the authority.",
    "",
    "Later prose mentions `speed_to_value` and `governance_compliance` for other reasons.",
  ].join("\n");

  const parsed = parseCostDimensionsFromAuthoring(source);

  assert.deepEqual(parsed, [
    "blast_radius",
    "human_cognitive_load",
    "vendor_lock_in",
    "business_disruption",
    "operator_effort",
  ]);
  assert.ok(!parsed.includes("speed_to_value"), "a later mention must not join the list");
});

test("refuses to parse when the pointer that bounds the list is gone", () => {
  // Without that sentence the parser cannot tell the list from the rest of the
  // paragraph, and a guard that cannot measure must say so rather than pass.
  const source = "   - **Cost axes must be negative.** `blast_radius` and others are costs.";

  assert.throws(() => parseCostDimensionsFromAuthoring(source), /points at the registry/);
});

test("refuses to parse when the paragraph is missing entirely", () => {
  assert.throws(() => parseCostDimensionsFromAuthoring("# Authoring\n\nNothing here."), /missing/);
});

test("reports exactly the axes the guide omits — the defect that motivated this", () => {
  const result = compareCostDimensions({
    code: ["blast_radius", "human_cognitive_load", "vendor_lock_in", "business_disruption", "operator_effort"],
    doc: ["blast_radius", "human_cognitive_load", "vendor_lock_in"],
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ["business_disruption", "operator_effort"]);
  assert.deepEqual(result.extra, []);
});

test("reports an axis the guide invents", () => {
  const result = compareCostDimensions({
    code: ["blast_radius"],
    doc: ["blast_radius", "data_sovereignty"],
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.extra, ["data_sovereignty"]);
});

test("agrees regardless of the order each side lists them in", () => {
  const result = compareCostDimensions({
    code: ["blast_radius", "operator_effort"],
    doc: ["operator_effort", "blast_radius"],
  });

  assert.equal(result.ok, true);
});
