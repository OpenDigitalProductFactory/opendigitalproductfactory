import assert from "node:assert/strict";
import { test } from "node:test";

import { decide, parsePlanCoverage } from "./plan-backlog-coverage-guard.mjs";

const mappedPlan = `# Federated demand network

**Backlog item:** \`BI-E3A084ED\`
**Plan size:** xlarge

## Backlog coverage
- Decision: decomposed
- Receipt: receipt-live
`;

test("rejects source work when five independent future slices have no live coverage receipt", async () => {
  const verdict = await decide({
    toolName: "Edit",
    toolInput: { file_path: "apps/web/lib/demand/federated.ts" },
    plans: [{ path: "docs/superpowers/plans/federated.md", text: mappedPlan.replace("receipt-live", "pending") }],
    checkReceipt: async () => ({ ok: true, valid: true }),
  });
  assert.equal(verdict.block, true);
  assert.match(verdict.reason, /live backlog coverage receipt/i);
});

test("allows a legitimately atomic phased plan after its receipt is revalidated", async () => {
  const plan = mappedPlan.replace("Decision: decomposed", "Decision: atomic");
  const verdict = await decide({
    toolName: "Write",
    toolInput: { file_path: "packages/example/src/atomic.ts" },
    plans: [{ path: "docs/superpowers/plans/atomic.md", text: plan }],
    checkReceipt: async ({ receiptId }) => ({ ok: true, valid: receiptId === "receipt-live", decision: "atomic" }),
  });
  assert.deepEqual(verdict, { block: false });
});

test("allows existing BI mappings when the governed receipt remains valid", async () => {
  let checked;
  const verdict = await decide({
    toolName: "MultiEdit",
    toolInput: { file_path: "apps/web/lib/demand/mapped.ts" },
    plans: [{ path: "docs/superpowers/plans/federated.md", text: mappedPlan }],
    checkReceipt: async (input) => {
      checked = input;
      return { ok: true, valid: true, decision: "decomposed", mappedItemIds: ["BI-1", "BI-2"] };
    },
  });
  assert.deepEqual(verdict, { block: false });
  assert.deepEqual(checked, {
    itemId: "BI-E3A084ED",
    planPath: "docs/superpowers/plans/federated.md",
    receiptId: "receipt-live",
  });
});

test("fails closed when MCP is unavailable or reports insufficient scope", async () => {
  for (const response of [
    { ok: false, error: "mcp_unavailable" },
    { ok: false, error: "insufficient_token_scope", requiredScope: "read" },
  ]) {
    const verdict = await decide({
      toolName: "Edit",
      toolInput: { file_path: "apps/web/lib/demand/federated.ts" },
      plans: [{ path: "docs/superpowers/plans/federated.md", text: mappedPlan }],
      checkReceipt: async () => response,
    });
    assert.equal(verdict.block, true);
    assert.match(verdict.reason, /MCP|scope/i);
  }
});

test("blocks an xlarge claimed branch before implementation even when no plan was written", async () => {
  const verdict = await decide({
    toolName: "Edit",
    toolInput: { file_path: "apps/web/lib/demand/unplanned.ts" },
    plans: [],
    branchName: "fix/unplanned-xlarge",
    checkReceipt: async () => ({ ok: true, valid: true }),
    checkBranch: async () => ({
      ok: false,
      required: true,
      error: "xlarge BacklogItem BI-PARENT requires a decomposition decision",
    }),
  });
  assert.equal(verdict.block, true);
  assert.match(verdict.reason, /xlarge|decomposition decision/i);
});

test("does not gate plan, test, or documentation edits needed to obtain a receipt", async () => {
  for (const file_path of [
    "docs/superpowers/plans/federated.md",
    "apps/web/lib/demand/federated.test.ts",
    "AGENTS.md",
  ]) {
    const verdict = await decide({
      toolName: "Edit",
      toolInput: { file_path },
      plans: [{ path: "docs/superpowers/plans/federated.md", text: mappedPlan.replace("receipt-live", "pending") }],
      checkReceipt: async () => ({ ok: false }),
    });
    assert.deepEqual(verdict, { block: false });
  }
});

test("parses the canonical coverage pointer without treating pending as a receipt", () => {
  assert.deepEqual(parsePlanCoverage(mappedPlan), {
    itemId: "BI-E3A084ED",
    decision: "decomposed",
    receiptId: "receipt-live",
  });
  assert.equal(parsePlanCoverage(mappedPlan.replace("receipt-live", "pending")).receiptId, null);
});
