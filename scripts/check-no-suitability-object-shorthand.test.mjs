import assert from "node:assert/strict";
import test from "node:test";

import { findShorthandProps } from "./check-no-suitability-object-shorthand.mjs";

// BI-573A8EB3. The two forms that actually appeared on the live install, one
// after the other, as each was fixed in turn.
test("flags the shorthand that broke plan routing", () => {
  const src = `deriveAiWorkloadDataProfile({ workloadClass, classificationKnown, applicableRegulationIds: g?.a })`;
  assert.deepEqual(findShorthandProps(src).sort(), ["classificationKnown", "workloadClass"]);
});

test("flags a lone shorthand (the onboarding call site)", () => {
  assert.deepEqual(findShorthandProps("deriveAiWorkloadDataProfile({ workloadClass })"), ["workloadClass"]);
});

test("accepts the explicit form the fix uses", () => {
  const src = `deriveAiWorkloadDataProfile({
    workloadClass: hintWorkloadClass,
    classificationKnown: hintClassificationKnown,
    applicableRegulationIds: governed?.applicableRegulationIds,
    processingActivityId: governed?.processingActivityId,
  })`;
  assert.deepEqual(findShorthandProps(src), []);
});

test("does not confuse a spread or a nested object for shorthand", () => {
  const src = `deriveAiWorkloadDataProfile({ workloadClass: x, ...rest, nested: { a } })`;
  assert.deepEqual(findShorthandProps(src), []);
});

test("scans every call in a file, not just the first", () => {
  const src = `
    deriveAiWorkloadDataProfile({ workloadClass: ok })
    deriveAiWorkloadDataProfile({ workloadClass })
  `;
  assert.deepEqual(findShorthandProps(src), ["workloadClass"]);
});

test("clean when there are no calls", () => {
  assert.deepEqual(findShorthandProps("const x = { workloadClass };"), []);
});
