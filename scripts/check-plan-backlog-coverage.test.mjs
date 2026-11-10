import assert from "node:assert/strict";
import { test } from "node:test";

import { validatePlanText } from "./check-plan-backlog-coverage.mjs";

const header = (coverage) => `# Plan
**Backlog item:** \`BI-PARENT\`
**Plan size:** xlarge

## Backlog coverage
${coverage}

## Slice 0
Delivered foundation.
`;

test("rejects an xlarge plan whose five independent future slices exist only in Markdown", () => {
  const text = `${header("- Decision: decomposed\n- Receipt: pending")}
## Slice 1 — independent
- [ ] Later
## Slice 2 — independent
- [ ] Later
## Slice 3 — independent
- [ ] Later
## Slice 4 — independent
- [ ] Later
## Slice 5 — independent
- [ ] Later
`;
  const result = validatePlanText("docs/superpowers/plans/federated.md", text);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /receipt|mapping/i);
});

test("allows a legitimately atomic phased plan with rationale and live receipt", () => {
  const result = validatePlanText("docs/superpowers/plans/atomic.md", header(`- Decision: atomic
- Parent: \`BI-PARENT\`
- Rationale: The phases share one compatibility boundary and none creates an independently useful outcome.
- Dependencies: none
- Receipt: receipt-atomic-1`));
  assert.deepEqual(result, { ok: true, errors: [] });
});

test("allows mappings to existing BIs and requires dependency recording", () => {
  const result = validatePlanText("docs/superpowers/plans/mapped.md", header(`- Decision: decomposed
- Parent: \`BI-PARENT\`
- Deliverables:
  - slice-1 -> \`BI-EXISTING-1\`; depends on: none
  - slice-2 -> \`BI-EXISTING-2\`; depends on: slice-1
- Dependencies: slice-2 -> slice-1
- Receipt: receipt-mapped-1`));
  assert.deepEqual(result, { ok: true, errors: [] });
});

test("accepts a plan whose receipt names the concrete blocking condition (merge does not wait on reviewer capacity)", () => {
  const result = validatePlanText(
    "docs/superpowers/plans/blocked.md",
    header(`- Decision: decomposed
- Parent: \`BI-PARENT\`
- Receipt: blocked-by: no initiative scope baseline exists for BI-PARENT (spec-approval receipt not yet recorded)
- Rationale: each child is one clean revert.
- Dependencies: slice-a -> \`BI-A\` (none); slice-b -> \`BI-B\` (BI-A)`),
  );
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

test("rejects a blocked-by receipt that names no real condition", () => {
  const result = validatePlanText(
    "docs/superpowers/plans/blocked-vague.md",
    header(`- Decision: decomposed
- Parent: \`BI-PARENT\`
- Receipt: blocked-by: later
- Rationale: each child is one clean revert.
- Dependencies: slice-a -> \`BI-A\` (none)`),
  );
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /concrete blocking condition/);
});
