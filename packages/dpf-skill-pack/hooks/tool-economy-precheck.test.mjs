import assert from "node:assert/strict";
import { test } from "node:test";

import { decide } from "./tool-economy-precheck.mjs";

// ── reminds when a governed context-economy surface is edited ─────────────────

test("reminds on an Edit to the MCP tool registry", () => {
  assert.equal(decide("Edit", { file_path: "apps/web/lib/mcp-tools.ts" }).remind, true);
});

test("reminds on an Edit to the MCP transport route", () => {
  assert.equal(decide("Edit", { file_path: "apps/web/app/api/mcp/v1/route.ts" }).remind, true);
});

test("reminds on an Edit to the agentic loop", () => {
  assert.equal(decide("Edit", { file_path: "apps/web/lib/tak/agentic-loop.ts" }).remind, true);
});

test("reminds on a Write to the result-budget module", () => {
  assert.equal(
    decide("Write", { file_path: "apps/web/lib/tak/tool-result-budget.ts", content: "x" }).remind,
    true,
  );
});

test("reminds via MultiEdit and normalizes an absolute path", () => {
  const v = decide("MultiEdit", {
    file_path: "D:\\DPF\\.claude\\worktrees\\topic\\apps\\web\\lib\\mcp-tools.ts",
  });
  assert.equal(v.remind, true);
  assert.equal(v.file, "apps/web/lib/mcp-tools.ts");
});

// ── stays quiet where it should ──────────────────────────────────────────────

test("does NOT remind for unrelated source files", () => {
  assert.equal(decide("Edit", { file_path: "apps/web/lib/actions/crm.ts" }).remind, false);
  assert.equal(decide("Write", { file_path: "apps/web/lib/tak/context-arbitrator.ts" }).remind, false);
});

test("does NOT remind for the registry's own test/sibling files", () => {
  assert.equal(decide("Write", { file_path: "apps/web/lib/tool-description-hygiene.test.ts" }).remind, false);
  assert.equal(decide("Edit", { file_path: "apps/web/lib/tak/tool-result-budget.test.ts" }).remind, false);
});

test("ignores non-write tools", () => {
  assert.equal(decide("Bash", { command: "ls" }).remind, false);
  assert.equal(decide("Read", { file_path: "apps/web/lib/mcp-tools.ts" }).remind, false);
});
