import { describe, expect, it, vi } from "vitest";

import { readinessRequirement } from "@/lib/backlog/initiative-readiness/readiness-guidance";
import type { InitiativeReadinessDecision } from "@/lib/backlog/initiative-readiness/types";
import type { InitiativeReviewerRecovery } from "@/lib/tak/initiative-readiness-tool-grants";

import { projectOwedAcceptance, type OwedAcceptanceOwnerResolver } from "./owed-acceptance";

// AC-AA-01 (docs/superpowers/specs/2026-09-24-acceptance-accountability-design.md §3.1):
// the projection names the specific unmet codes, the resolved owner, or the
// unroutable reason. It never defaults to a person and never to the author.

function completionDecision(overrides: Partial<InitiativeReadinessDecision>): InitiativeReadinessDecision {
  return {
    decisionId: "unpersisted",
    policyVersion: "initiative-readiness.v3",
    subject: { kind: "backlog-item", id: "BI-AA000001" },
    transitionObject: { kind: "backlog-item", id: "BI-AA000001", expectedVersion: "read-projection", targetState: "completion" },
    profile: "feature",
    target: "completion",
    verdict: "input-required",
    satisfied: [],
    unmet: [],
    blockers: [],
    evaluatedAt: "2026-10-06T00:00:00.000Z",
    ...overrides,
  };
}

// Live shape 1 — a medium feature parked after merge (BI-5F3D6A37 itself, 2026-10-06).
const mediumFeature = completionDecision({
  unmet: [
    readinessRequirement({ code: "PLAN_REVIEW_REQUIRED", state: "missing", accountableRole: "plan-reviewer" }),
    readinessRequirement({ code: "DELIVERY_EVIDENCE_REQUIRED", state: "missing", accountableRole: "delivery-coordinator" }),
    readinessRequirement({ code: "ACCEPTANCE_EVIDENCE_REQUIRED", state: "missing", accountableRole: "acceptance-reviewer" }),
    readinessRequirement({ code: "OBJECTIVE_RECONCILIATION_REQUIRED", state: "missing", accountableRole: "acceptance-reviewer" }),
  ],
});

// Live shape 2 — a small fix that owes only its acceptance evidence.
const smallFix = completionDecision({
  profile: "fix",
  unmet: [
    readinessRequirement({ code: "ACCEPTANCE_EVIDENCE_REQUIRED", state: "missing", accountableRole: "acceptance-reviewer" }),
  ],
});

function route(targetAgentId: string, accountableRole = "acceptance-reviewer"): InitiativeReviewerRecovery["reviewerRoutes"][number] {
  return {
    accountableRole,
    toolName: "record_initiative_evidence",
    grant: "initiative_evidence_write",
    gate: "objective-mapping",
    targetAgentId,
    targetDisplayName: `${targetAgentId} name`,
    independent: false,
    workroomId: "WC-1",
    repositoryFullName: "o/r",
    branchName: "feat/x",
    headSha: "a".repeat(40),
    requestCoworker: {
      targetAgent: targetAgentId,
      objective: "o",
      questionPacketSummary: "q",
      requestKey: "k",
      tier: 2,
      enteredVia: "handoff",
    },
  };
}

function resolverReturning(recovery: Partial<InitiativeReviewerRecovery>) {
  return vi.fn<OwedAcceptanceOwnerResolver>().mockResolvedValue({
    reviewerRoutes: [],
    escalations: [],
    unroutable: [],
    ...recovery,
  });
}

describe("projectOwedAcceptance", () => {
  it("names every unmet code with its accountable role and next action, and the resolved owner", async () => {
    const resolveOwner = resolverReturning({
      reviewerRoutes: [route("AGT-WS-ACCEPT")],
      unroutable: [{ accountableRole: "delivery-coordinator", code: "DELIVERY_EVIDENCE_REQUIRED", nextAction: "Record delivery evidence for the merged change with record_execution_evidence." }],
    });

    const result = await projectOwedAcceptance({ decision: mediumFeature, authorAgentId: "AGT-AUTHOR", resolveOwner });

    expect(result.owed).toEqual(mediumFeature.unmet.map((entry) => ({
      code: entry.code,
      state: entry.state,
      accountableRole: entry.accountableRole,
      nextAction: entry.nextAction,
    })));
    expect(result.owner).toEqual({
      agentId: "AGT-WS-ACCEPT",
      displayName: "AGT-WS-ACCEPT name",
      codes: ["ACCEPTANCE_EVIDENCE_REQUIRED", "OBJECTIVE_RECONCILIATION_REQUIRED"],
    });
    expect(result.unroutable).toEqual([{
      code: "DELIVERY_EVIDENCE_REQUIRED",
      accountableRole: "delivery-coordinator",
      reason: "no-writer-lane",
      nextAction: "Record delivery evidence for the merged change with record_execution_evidence.",
    }]);
    expect(result.closable).toBe(false);
  });

  it("asks the resolver only about the acceptance-family requirements, as the author", async () => {
    const resolveOwner = resolverReturning({ reviewerRoutes: [route("AGT-WS-ACCEPT")] });

    await projectOwedAcceptance({ decision: mediumFeature, authorAgentId: "AGT-AUTHOR", resolveOwner });

    expect(resolveOwner).toHaveBeenCalledTimes(1);
    const args = resolveOwner.mock.calls[0]![0];
    expect(args.authorAgentId).toBe("AGT-AUTHOR");
    expect([...args.decision.blockers, ...args.decision.unmet].map((entry) => entry.code)).toEqual([
      "DELIVERY_EVIDENCE_REQUIRED",
      "ACCEPTANCE_EVIDENCE_REQUIRED",
      "OBJECTIVE_RECONCILIATION_REQUIRED",
    ]);
  });

  it("never names the authoring agent as owner, even on the non-independent acceptance lane", async () => {
    const resolveOwner = resolverReturning({ reviewerRoutes: [route("AGT-AUTHOR")] });

    const result = await projectOwedAcceptance({ decision: smallFix, authorAgentId: "AGT-AUTHOR", resolveOwner });

    expect(result.owner).toBeNull();
    expect(result.unroutable).toEqual([expect.objectContaining({
      code: "ACCEPTANCE_EVIDENCE_REQUIRED",
      accountableRole: "acceptance-reviewer",
      reason: "author-excluded",
    })]);
  });

  it("reports an item with no granted coworker as unroutable with the resolver's reason, not routed to a person", async () => {
    const resolveOwner = resolverReturning({
      escalations: [{
        accountableRole: "acceptance-reviewer",
        toolName: "record_initiative_evidence",
        grant: "initiative_evidence_write",
        reason: "no-eligible-reviewer",
        nextAction: "Assign or activate a production reviewer with exact grants initiative_evidence_write and file_read on the same agent; do not proxy the receipt.",
      }],
    });

    const result = await projectOwedAcceptance({ decision: smallFix, authorAgentId: "AGT-AUTHOR", resolveOwner });

    expect(result.owner).toBeNull();
    expect(result.unroutable).toEqual([{
      code: "ACCEPTANCE_EVIDENCE_REQUIRED",
      accountableRole: "acceptance-reviewer",
      reason: "no-eligible-reviewer",
      nextAction: "Assign or activate a production reviewer with exact grants initiative_evidence_write and file_read on the same agent; do not proxy the receipt.",
    }]);
  });

  it("reports a family requirement the resolver said nothing about as unresolved rather than dropping it", async () => {
    const result = await projectOwedAcceptance({ decision: smallFix, authorAgentId: null, resolveOwner: resolverReturning({}) });

    expect(result.unroutable).toEqual([expect.objectContaining({ code: "ACCEPTANCE_EVIDENCE_REQUIRED", reason: "unresolved" })]);
  });

  it("includes blocking requirements in what is owed", async () => {
    const decision = completionDecision({
      verdict: "denied",
      blockers: [readinessRequirement({ code: "STALE_EVIDENCE", state: "blocked", accountableRole: "acceptance-reviewer" })],
    });
    const result = await projectOwedAcceptance({ decision, authorAgentId: "AGT-AUTHOR", resolveOwner: resolverReturning({ reviewerRoutes: [route("AGT-WS-ACCEPT")] }) });

    expect(result.owed.map((entry) => entry.code)).toEqual(["STALE_EVIDENCE"]);
    expect(result.owner?.codes).toEqual(["STALE_EVIDENCE"]);
  });

  it("ignores routes for roles outside the acceptance family", async () => {
    const resolveOwner = resolverReturning({ reviewerRoutes: [route("AGT-WS-PLAN", "plan-reviewer"), route("AGT-WS-ACCEPT")] });

    const result = await projectOwedAcceptance({ decision: smallFix, authorAgentId: "AGT-AUTHOR", resolveOwner });

    expect(result.owner?.agentId).toBe("AGT-WS-ACCEPT");
  });

  // Live shape 3 — completion already allowed: closable, owes nothing, no resolver call.
  it("reports an allowed completion as closable without resolving an owner", async () => {
    const resolveOwner = resolverReturning({});
    const result = await projectOwedAcceptance({
      decision: completionDecision({ verdict: "allowed" }),
      authorAgentId: "AGT-AUTHOR",
      resolveOwner,
    });

    expect(result).toEqual({ owed: [], owner: null, unroutable: [], closable: true });
    expect(resolveOwner).not.toHaveBeenCalled();
  });
});
