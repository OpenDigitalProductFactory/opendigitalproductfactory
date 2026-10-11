import { describe, expect, it, vi } from "vitest";

import { readinessRequirement } from "@/lib/backlog/initiative-readiness/readiness-guidance";
import type { InitiativeReadinessDecision } from "@/lib/backlog/initiative-readiness/types";

import { createOwedAcceptanceOwnerResolver } from "./owed-acceptance-owner";
import { projectOwedAcceptance } from "./owed-acceptance";

// The production owner port runs the real grant-backed resolver
// (resolveInitiativeReviewerRecovery). The acceptance lane is not marked
// independent, so the resolver alone would happily pick the author; the port
// removes the author from the candidate roster before it resolves.

const decision: InitiativeReadinessDecision = {
  decisionId: "unpersisted",
  policyVersion: "initiative-readiness.v3",
  subject: { kind: "backlog-item", id: "BI-AA000002" },
  transitionObject: { kind: "backlog-item", id: "BI-AA000002", expectedVersion: "read-projection", targetState: "completion" },
  profile: "fix",
  target: "completion",
  verdict: "input-required",
  satisfied: [],
  unmet: [readinessRequirement({ code: "OBJECTIVE_RECONCILIATION_REQUIRED", state: "missing", accountableRole: "acceptance-reviewer" })],
  blockers: [],
  evaluatedAt: "2026-10-06T00:00:00.000Z",
};

const dispatchContext = {
  workroomId: "WC-ACCEPT01",
  repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
  branchName: "fix/acceptance-fixture",
  headSha: "21103703757a342c828dd6ef1bb9acc97a4b01f8",
};

const canonicalArtifact = {
  resolved: true as const,
  path: "docs/superpowers/specs/2026-09-24-acceptance-accountability-design.md",
  providerBlobId: "9f2c1d4e6b8a0c2e4f6a8b0c2d4e6f8a0b2c4d6e",
};

function grantRows(agentId: string) {
  const agent = { agentId, displayName: `${agentId} name`, status: "active", archived: false, lifecycleStage: "production" };
  return [
    { grantKey: "initiative_evidence_write", agent },
    { grantKey: "file_read", agent },
  ];
}

function resolverWith(rows: ReturnType<typeof grantRows>) {
  return createOwedAcceptanceOwnerResolver({
    db: { agentToolGrant: { findMany: vi.fn().mockResolvedValue(rows) } },
    dispatchContext,
    canonicalArtifact,
    expectedCurrentBaselineId: "baseline-current",
    eligibleEvidenceActivityIds: ["act-post-baseline-1"],
  });
}

describe("createOwedAcceptanceOwnerResolver", () => {
  it("resolves a granted coworker other than the author, even when the author sorts first", async () => {
    const resolveOwner = resolverWith([...grantRows("AGT-A-AUTHOR"), ...grantRows("AGT-WS-ACCEPT")]);

    const result = await projectOwedAcceptance({ decision, authorAgentId: "AGT-A-AUTHOR", resolveOwner });

    expect(result.owner).toEqual({
      agentId: "AGT-WS-ACCEPT",
      displayName: "AGT-WS-ACCEPT name",
      codes: ["OBJECTIVE_RECONCILIATION_REQUIRED"],
    });
    expect(result.unroutable).toEqual([]);
  });

  it("reports no eligible reviewer when the author is the only granted coworker", async () => {
    const resolveOwner = resolverWith(grantRows("AGT-A-AUTHOR"));

    const result = await projectOwedAcceptance({ decision, authorAgentId: "AGT-A-AUTHOR", resolveOwner });

    expect(result.owner).toBeNull();
    expect(result.unroutable).toEqual([expect.objectContaining({
      code: "OBJECTIVE_RECONCILIATION_REQUIRED",
      reason: "no-eligible-reviewer",
    })]);
  });

  it("reports an unroutable reason, never an owner, when the dispatch context is absent", async () => {
    const resolveOwner = createOwedAcceptanceOwnerResolver({
      db: { agentToolGrant: { findMany: vi.fn().mockResolvedValue(grantRows("AGT-WS-ACCEPT")) } },
      dispatchContext: null,
    });

    const result = await projectOwedAcceptance({ decision, authorAgentId: "AGT-AUTHOR", resolveOwner });

    expect(result.owner).toBeNull();
    expect(result.unroutable).toEqual([expect.objectContaining({ reason: "dispatch-context-required" })]);
  });
});

describe("createOwedAcceptanceOwnerResolver: delivery actors (BI-099A0BA3, security review M1)", () => {
  it("removes every delivery actor from the roster, not only the author", async () => {
    const resolveOwner = resolverWith([...grantRows("AGT-A-DELIVERED"), ...grantRows("AGT-B-AUTHOR"), ...grantRows("AGT-WS-ACCEPT")]);

    const result = await projectOwedAcceptance({
      decision, authorAgentId: "AGT-B-AUTHOR", excludedAgentIds: ["AGT-A-DELIVERED"], resolveOwner,
    });

    expect(result.owner?.agentId).toBe("AGT-WS-ACCEPT");
  });
});
