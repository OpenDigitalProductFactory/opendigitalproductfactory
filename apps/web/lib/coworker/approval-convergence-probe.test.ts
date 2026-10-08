import { describe, expect, it, vi } from "vitest";

import type { CoworkerAuthorityDecision } from "@/lib/govern/authority/coworker-authority-decision";

import { convertAndRunArgs, probePendingProposal, summarizeProbe, type PendingProposalRow, type ProbeDeps } from "./approval-convergence-probe";

const NOW = new Date("2026-10-07T12:00:00Z");
const ROW: PendingProposalRow = {
  proposalId: "prop-1",
  actionType: "run_hive_scout_ingest",
  parameters: { limit: 5 },
  agentId: "AGT-SCOUT",
  threadId: "scheduled:thread-1",
  taskRunId: "TR-SCHED-1",
  proposedAt: new Date("2026-08-21T12:00:00Z"),
  owner: { id: "user-1", isActive: true, lastSeenAt: new Date("2026-10-07T09:00:00Z") },
};
const ALLOW = { outcome: "require-approval", reasonCode: "approval-required", escalation: { reasonCode: "damaging-consequence" } } as unknown as CoworkerAuthorityDecision;

function deps(over: Partial<ProbeDeps> = {}): ProbeDeps {
  return {
    findTool: () => ({ name: "run_hive_scout_ingest", consequence: "outward", sideEffect: true } as never),
    userContext: async (userId) => ({ userId, platformRole: "HR-000", isSuperuser: true }),
    agentGrantAllowed: async () => true,
    resolveAuthorityInput: vi.fn(async () => ({}) as never),
    evaluate: () => ALLOW,
    resolveGaid: async () => ({ gaid: "gaid:x" }),
    preToolHooks: async () => null,
    alignmentRequired: () => true,
    ...over,
  };
}

describe("approval convergence probe (AC-PROBE)", () => {
  it("dry-runs exactly the convert-and-run call: today's { agentId, threadId }, the owner as approver, source rest", () => {
    expect(convertAndRunArgs(ROW, "user-1", { userId: "user-1", platformRole: null, isSuperuser: false })).toEqual({
      toolName: "run_hive_scout_ingest",
      rawParams: { limit: 5 },
      userId: "user-1",
      userContext: { userId: "user-1", platformRole: null, isSuperuser: false },
      context: { agentId: "AGT-SCOUT", threadId: "scheduled:thread-1" },
      source: "rest",
    });
  });

  it("reports an admissible row with its escalation and owner activity", async () => {
    const result = await probePendingProposal(ROW, deps(), NOW);
    expect(result).toMatchObject({
      refusal: "admissible-after-approval", authorityOutcome: "require-approval", escalation: "damaging-consequence",
      gaid: "resolved", hook: "allow", alignmentRequired: true, ownerActive: true, ageDays: 47,
      ownerLastSeenAt: "2026-10-07T09:00:00.000Z",
    });
  });

  it("names the first refusal convert-and-run would hit", async () => {
    const deny = { outcome: "deny", reasonCode: "agent-grant-denied" } as unknown as CoworkerAuthorityDecision;
    expect((await probePendingProposal(ROW, deps({ evaluate: () => deny }), NOW)).refusal).toBe("agent-grant-denied");
    expect((await probePendingProposal(ROW, deps({ resolveAuthorityInput: async () => { throw new Error("The executing coworker identity is not active."); } }), NOW)))
      .toMatchObject({ refusal: "authority-evidence-unavailable", detail: "The executing coworker identity is not active." });
    expect((await probePendingProposal(ROW, deps({ preToolHooks: async () => ({ success: false, message: "room refused" }) }), NOW)).refusal).toBe("hook-denied");
    expect((await probePendingProposal(ROW, deps({ resolveGaid: async () => null }), NOW)).refusal).toBe("gaid-missing");
    expect((await probePendingProposal(ROW, deps({ findTool: () => undefined }), NOW)).refusal).toBe("unknown-tool");
    expect((await probePendingProposal({ ...ROW, owner: null }, deps(), NOW)).refusal).toBe("owner-missing");
    expect((await probePendingProposal(ROW, deps({ userContext: async () => null }), NOW)).refusal).toBe("owner-inactive");
  });

  it("a write the read-only session refuses is reported, not retried", async () => {
    const result = await probePendingProposal(ROW, deps({ preToolHooks: async () => { throw new Error("cannot execute INSERT in a read-only transaction"); } }), NOW);
    expect(result).toMatchObject({ refusal: "hook-error", hook: "error", detail: "cannot execute INSERT in a read-only transaction" });
  });

  it("summarises by refusal code and owner", async () => {
    const rows = [await probePendingProposal(ROW, deps(), NOW), await probePendingProposal({ ...ROW, proposalId: "prop-2" }, deps({ resolveGaid: async () => null }), NOW)];
    expect(summarizeProbe(rows)).toEqual({
      rows: 2,
      byRefusal: { "admissible-after-approval": 1, "gaid-missing": 1 },
      byOwner: { "user-1": { rows: 2, active: true, lastSeenAt: "2026-10-07T09:00:00.000Z" } },
    });
  });
});
