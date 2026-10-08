// BI-77C600B2: a refused implementation claim binds no workroom, and the
// research receipt cites a commit on a live one. Advising the receipt without
// the design-intent claim that binds the room sent every author round a loop:
// the receipt said "claim first", and the claim was refused at this same gate.

import { describe, expect, it, vi } from "vitest";

import type { InitiativeReadinessDecision } from "@/lib/backlog/initiative-readiness";
import { readinessRequirement } from "@/lib/backlog/initiative-readiness/readiness-guidance";

import { resolveInitiativeReviewerRecovery } from "./initiative-readiness-tool-grants";

const decision: InitiativeReadinessDecision = {
  decisionId: "IRD-RESEARCH-ORDER",
  policyVersion: "initiative-readiness.v3",
  subject: { kind: "backlog-item", id: "BI-77C600B2" },
  transitionObject: { kind: "work-capsule", id: "WC-5D57E826", expectedVersion: "claim.v1", targetState: "implementation" },
  profile: "fix",
  target: "implementation",
  verdict: "input-required",
  satisfied: [],
  unmet: [readinessRequirement({ code: "RESEARCH_REQUIRED", state: "missing", accountableRole: "design-author" })],
  blockers: [],
  evaluatedAt: "2026-10-08T02:00:00.000Z",
};

const writerRows = [
  { grantKey: "initiative_evidence_write", agent: { agentId: "AGT-WS-BUILD", displayName: "Build Specialist", status: "active", archived: false, lifecycleStage: "production" } },
  { grantKey: "file_read", agent: { agentId: "AGT-WS-BUILD", displayName: "Build Specialist", status: "active", archived: false, lifecycleStage: "production" } },
];

describe("the claim's research escalation names the claim that binds the receipt's workroom (BI-77C600B2)", () => {
  it.each([
    ["fix", "small"],
    ["feature", "small"],
    ["fix", "medium"],
  ] as const)("profile %s, shape %s: design claim, then receipt, then implementation claim", async (profile, effective) => {
    const recovery = await resolveInitiativeReviewerRecovery({
      decision: {
        ...decision,
        profile,
        shapeDecision: { declared: effective, effective, sensitivity: "low", raised: false },
      },
      currentAgentId: "AGT-AUTHOR",
      db: { agentToolGrant: { findMany: vi.fn().mockResolvedValue(writerRows) } },
      dispatchContext: {
        workroomId: "WC-5D57E826",
        repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
        branchName: "fix/research-receipt-claim-deadlock",
        headSha: "d2f09ff53792d04a5f0368b2f7bc462465e77028",
      },
      canonicalArtifact: { resolved: false, nextAction: "No canonical design is owed by this shape." },
    });

    expect(recovery.escalations).toMatchObject([{ reason: "research-evidence-required" }]);
    const nextAction = recovery.escalations[0]?.nextAction ?? "";
    expect(nextAction).toContain("workIntent \"design\"");
    expect(nextAction.indexOf("workIntent \"design\"")).toBeLessThan(nextAction.indexOf("workIntent \"implementation\""));
  });
});
