// BI-1CA8817B: `durationMs` carried a literal 0 on every pre-execution path in
// mcp-governed-execute.ts, so the column meant both "refused before the tool
// ran" and "ran in under a millisecond". Readers could not tell those apart,
// and the average over the column was dragged toward zero by refusals that
// never executed anything. PR #5922 stopped the audit SUMMARY from exposing
// that ambiguity; this suite pins the column itself.
//
// Its own file rather than an addition to mcp-governed-execute.test.ts: that
// file sits one line under the 800-line module soft ceiling, so appending to it
// trips check-no-substrate-regression.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _setGovernanceForTests,
  governedExecuteTool,
  registerToolLifecycleHook,
} from "./mcp-governed-execute";
import type { ToolResult } from "./mcp-tool-types";

const USER = { platformRole: "ceo", isSuperuser: true };

let auditRows: Record<string, unknown>[];
let execute: ReturnType<typeof vi.fn>;

beforeEach(() => {
  auditRows = [];
  execute = vi.fn(async (): Promise<ToolResult> => ({ success: true, message: "ok" }));
  _setGovernanceForTests({
    executeTool: execute as never,
    toolExecutionCreate: async (data) => { auditRows.push(data); return { id: `exec-${auditRows.length}` }; },
    toolExecutionUpdate: async () => undefined,
  });
});

afterEach(() => {
  _setGovernanceForTests({ executeTool: null, toolExecutionCreate: null, toolExecutionUpdate: null });
});

function call() {
  return governedExecuteTool({
    toolName: "query_backlog", rawParams: {}, userId: "user-1", userContext: USER, source: "rest",
  });
}

describe("audit durationMs separates 'did not run' from 'ran fast'", () => {
  it("records null when a hook refuses the call before execution", async () => {
    const unregister = registerToolLifecycleHook({
      id: "duration-null-refusal-hook",
      onPreToolUse: async () => ({ decision: "deny" as const, reason: "blocked by hook" }),
    });

    try {
      const result = await call();

      expect(result.success).toBe(false);
      expect(execute).not.toHaveBeenCalled();
      expect(auditRows).toHaveLength(1);
      // Null, not 0: tool-execution-data.ts averages with
      // `where: { durationMs: { not: null } }`, so a call that never ran must not
      // enter the mean, and the UI readers render an em dash, not a false "0ms".
      expect(auditRows[0]!.durationMs).toBeNull();
    } finally {
      unregister();
    }
  });

  it("records a number when the tool actually ran", async () => {
    const result = await call();

    expect(result.success).toBe(true);
    expect(execute).toHaveBeenCalledOnce();
    expect(auditRows).toHaveLength(1);
    expect(typeof auditRows[0]!.durationMs).toBe("number");
  });
});
