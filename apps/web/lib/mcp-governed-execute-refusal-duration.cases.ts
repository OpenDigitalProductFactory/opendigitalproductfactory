// BI-1CA8817B — a pre-execution refusal records no duration, asserted END TO END.
//
// PR #5957 made the seven pre-execution paths in mcp-governed-execute.ts write
// `durationMs: null` instead of a literal 0, so the column stops meaning both
// "refused before the tool ran" and "ran in under a millisecond". Its test proves
// the WRITER forwards a null through to the row. Nothing proved the CALL SITES
// pass null.
//
// That gap is measured, not assumed: reverting any one of the seven sites to
// `durationMs: 0` leaves the whole existing suite green (57 tests passed with the
// regression in place). A refusal that silently went back to recording 0 would
// ship.
//
// SCOPE, STATED HONESTLY: these cases cover ONE of the seven paths — the
// pre-tool-hook denial (mcp-governed-execute.ts:514). Verified by injecting the
// regression at each site in turn: only 514 fails these cases; 360, 425, 477,
// 544, 595 and 616 remain uncovered end to end. They need different governance
// setup (grants, authority envelopes, permit enforcement) and belong with the
// suites that already stand that harness up. This module is the home for them.
//
// These are cases rather than their own test file because the governed-execute
// harness (preflight stubs, authority overrides, audit capture) lives in
// mcp-governed-execute.test.ts, which sits AT the 800-LOC module ceiling. The
// *.cases.ts split is the pattern that file already uses.

import { describe, expect, it } from "vitest";

import { governedExecuteTool, type _setGovernanceForTests } from "./mcp-governed-execute";

const DENY_HOOK = {
  id: "block-dangerous-command",
  onPreToolUse: async () => ({ decision: "deny" as const, reason: "Sandbox command requires review" }),
};

export function registerRefusalDurationCases(evidence: {
  auditRows: () => Record<string, unknown>[];
  applyOverrides(overrides: Parameters<typeof _setGovernanceForTests>[0]): void;
  normalUser: { platformRole: string; isSuperuser: boolean };
  executionCalls: () => unknown[][];
}): void {
  // Owns its describe() so the call site is a single line — that file is at the
  // 800-LOC module ceiling.
  describe("governedExecuteTool — a hook-denied call records no duration (BI-1CA8817B)", () => {
  const denySandbox = () =>
    governedExecuteTool({
      toolName: "run_sandbox_command",
      rawParams: { command: "pnpm build" },
      userId: "user-1",
      userContext: evidence.normalUser,
      context: { agentId: "AGT-300", threadId: "thread-1" },
      source: "agentic-loop",
    });

  const runQuery = () =>
    governedExecuteTool({
      toolName: "query_backlog",
      rawParams: { status: "open" },
      userId: "user-1",
      userContext: evidence.normalUser,
      context: { agentId: "AGT-100", threadId: "thread-1" },
      source: "rest",
    });

  // Injecting `durationMs: 0` at mcp-governed-execute.ts:514 fails this case;
  // the pre-existing suite stays green against the same regression.
  it("records a null duration when a pre-tool hook denies the call before it runs", async () => {
    evidence.applyOverrides({
      resolveAgentGrants: async () => ["sandbox_execute"],
      lifecycleHooks: [DENY_HOOK],
    });

    const denied = await denySandbox();

    expect(denied.success).toBe(false);
    expect(denied.error).toBe("hook_denied");
    expect(evidence.executionCalls()).toHaveLength(0);
    expect(evidence.auditRows()).toHaveLength(1);
    // The assertion that fails against the old producer: it wrote +0 here.
    expect(evidence.auditRows()[0]!.durationMs).toBeNull();
  });

  it("records a number when the tool actually executed", async () => {
    evidence.applyOverrides({});

    const ran = await runQuery();

    expect(ran.success).toBe(true);
    expect(evidence.auditRows()).toHaveLength(1);
    expect(typeof evidence.auditRows()[0]!.durationMs).toBe("number");
  });

  it("leaves a hook denial and an execution distinguishable on the column", async () => {
    evidence.applyOverrides({
      resolveAgentGrants: async () => ["sandbox_execute"],
      lifecycleHooks: [DENY_HOOK],
    });
    await denySandbox();

    evidence.applyOverrides({});
    await runQuery();

    const rows = evidence.auditRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.durationMs).toBeNull();
    expect(typeof rows[1]!.durationMs).toBe("number");
    expect(rows[0]!.durationMs).not.toBe(rows[1]!.durationMs);
  });
  });
}
