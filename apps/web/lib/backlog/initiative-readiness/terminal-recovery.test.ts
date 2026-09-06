import { describe, expect, it, vi } from "vitest";

import { err, ok } from "@/lib/shared/action-result";
import { createObjectiveMappingRequestKey } from "@/lib/mcp-task-objective-mapping-request-key";
import { resolveInitiativeReviewerRecovery } from "@/lib/tak/initiative-readiness-tool-grants";

import { readinessRequirement } from "./readiness-guidance";
import type { InitiativeReadinessDecision } from "./types";
import { resolveTerminalInitiativeRecovery } from "./terminal-recovery";

const baseSha = "1".repeat(40);
const headSha = "2".repeat(40);
const baselineCommitSha = "5".repeat(40);
const eligibleEvidenceActivityIds = [
  "cmtnr924q-post-baseline",
  "cmtnr926e-post-baseline",
  "cmtnr927v-post-baseline",
  "cmtnr9295-post-baseline",
];
const decision: InitiativeReadinessDecision = {
  decisionId: "IRD-TERMINAL",
  policyVersion: "initiative-readiness.v2",
  subject: { kind: "backlog-item", id: "BI-TERMINAL" },
  transitionObject: { kind: "backlog-item", id: "BI-TERMINAL", expectedVersion: "in-progress", targetState: "done" },
  profile: "fix",
  target: "completion",
  verdict: "denied",
  satisfied: [],
  unmet: [readinessRequirement({
    code: "ACCEPTANCE_EVIDENCE_REQUIRED",
    state: "missing",
    accountableRole: "acceptance-reviewer",
  })],
  blockers: [],
  evaluatedAt: "2026-09-01T12:00:00.000Z",
};

const room = {
  capsuleId: "WC-TERMINAL",
  backlogItemId: "BI-TERMINAL",
  repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
  baseSha,
  headBranch: "fix/terminal",
  headSha,
  isLive: true,
};

function deps(rooms = [room], baselines: unknown[] = [{ baselineId: "baseline-current", supersedesBaselineId: null }]) {
  return {
    loadLiveRooms: vi.fn().mockResolvedValue(rooms),
    loadBaselinePayloads: vi.fn().mockResolvedValue(baselines),
    loadEligibleEvidenceActivityIds: vi.fn().mockResolvedValue(ok({
      activityIds: eligibleEvidenceActivityIds,
    })),
    loadObjectiveMappingHistory: vi.fn().mockResolvedValue(ok({ history: [] })),
    verifyHistoricalArtifact: vi.fn().mockResolvedValue(ok(new Uint8Array([1]))),
    discoverArtifact: vi.fn().mockResolvedValue({
      resolved: true,
      artifact: { path: "docs/superpowers/specs/design.md", providerBlobId: "3".repeat(40) },
    }),
    resolveRecovery: vi.fn().mockImplementation(async (
      input: Parameters<typeof resolveInitiativeReviewerRecovery>[0],
    ) => {
      const dispatch = input.dispatchContext;
      const artifact = input.canonicalArtifact;
      if (!dispatch || !artifact?.resolved || !input.eligibleEvidenceActivityIds) {
        throw new Error("test expected a complete objective-mapping recovery input");
      }
      const objective = `For BI-TERMINAL in ${dispatch.workroomId} on ${dispatch.repositoryFullName}#${dispatch.branchName} at Workroom head ${dispatch.headSha}, address objective-mapping using record_initiative_evidence.`;
      const questionPacketSummary = `objective-mapping for BI-TERMINAL at ${dispatch.headSha.slice(0, 12)}`;
      const binding = {
        writerToolName: "record_initiative_evidence",
        itemId: "BI-TERMINAL",
        gate: "objective-mapping" as const,
        expectedCurrentBaselineId: input.expectedCurrentBaselineId,
        eligibleEvidenceActivityIds: [...input.eligibleEvidenceActivityIds],
        workroomRef: {
          kind: "workroom-head" as const,
          workroomId: dispatch.workroomId,
          repositoryFullName: dispatch.repositoryFullName,
          branchName: dispatch.branchName,
          headSha: dispatch.headSha,
        },
        artifactRef: {
          kind: "repo-blob-at-commit" as const,
          repositoryFullName: dispatch.repositoryFullName,
          commitSha: artifact.commitSha ?? dispatch.headSha,
          path: artifact.path,
          providerBlobId: artifact.providerBlobId,
        },
      };
      const requiredToolNames = ["record_initiative_evidence", "read_source_at_version"];
      return {
        reviewerRoutes: [{
          gate: "objective-mapping",
          requestCoworker: {
            targetAgent: "AGT-WS-PORTFOLIO",
            objective,
            questionPacketSummary,
            requestKey: createObjectiveMappingRequestKey({
              targetAgent: "AGT-WS-PORTFOLIO",
              objective,
              questionPacketSummary,
              requiredToolNames,
              binding,
            }),
            requiredToolNames,
            initiativeReviewBinding: binding,
          },
        }],
        escalations: [],
        unroutable: [],
      };
    }),
  };
}

describe("terminal initiative recovery", () => {
  it("binds the unique live room, current baseline, and provider-verified artifact", async () => {
    const ports = deps();
    const result = await resolveTerminalInitiativeRecovery({
      decision,
      currentAgentId: "AGT-CALLER",
      refusedWorkroomId: null,
      ports,
    });

    expect(ports.discoverArtifact).toHaveBeenCalledWith(expect.objectContaining({
      repositoryFullName: room.repositoryFullName,
      baseSha,
      headSha,
    }));
    expect(ports.resolveRecovery).toHaveBeenCalledWith(expect.objectContaining({
      decision,
      currentAgentId: "AGT-CALLER",
      dispatchContext: {
        workroomId: room.capsuleId,
        repositoryFullName: room.repositoryFullName,
        branchName: room.headBranch,
        headSha,
      },
      canonicalArtifact: { resolved: true, path: "docs/superpowers/specs/design.md", providerBlobId: "3".repeat(40) },
      expectedCurrentBaselineId: "baseline-current",
      eligibleEvidenceActivityIds,
    }));
    expect(ports.loadObjectiveMappingHistory).toHaveBeenCalledWith({
      itemId: decision.subject.id,
      headSha,
    });
    expect(result.reviewerRoutes).toMatchObject([{ gate: "objective-mapping" }]);
  });

  it("fails closed while historical objective-mapping approval authority is active", async () => {
    const ports = deps();
    const routePacket = {
      targetAgent: "AGT-WS-PORTFOLIO",
      objective: `For BI-TERMINAL in WC-TERMINAL on ${room.repositoryFullName}#${room.headBranch} at Workroom head ${headSha}, address objective-mapping using record_initiative_evidence.`,
      questionPacketSummary: `objective-mapping for BI-TERMINAL at ${headSha.slice(0, 12)}`,
      requestKey: "placeholder",
      requiredToolNames: ["record_initiative_evidence", "read_source_at_version"],
      initiativeReviewBinding: {
        writerToolName: "record_initiative_evidence",
        itemId: "BI-TERMINAL",
        gate: "objective-mapping" as const,
        expectedCurrentBaselineId: "baseline-current",
        eligibleEvidenceActivityIds,
        workroomRef: {
          kind: "workroom-head" as const,
          workroomId: room.capsuleId,
          repositoryFullName: room.repositoryFullName,
          branchName: room.headBranch,
          headSha,
        },
        artifactRef: {
          kind: "repo-blob-at-commit" as const,
          repositoryFullName: room.repositoryFullName,
          commitSha: headSha,
          path: "docs/superpowers/specs/design.md",
          providerBlobId: "3".repeat(40),
        },
      },
    };
    routePacket.requestKey = createObjectiveMappingRequestKey({
      targetAgent: routePacket.targetAgent,
      objective: routePacket.objective,
      questionPacketSummary: routePacket.questionPacketSummary,
      requiredToolNames: routePacket.requiredToolNames,
      binding: routePacket.initiativeReviewBinding,
    });
    ports.resolveRecovery.mockResolvedValue({
      reviewerRoutes: [{ gate: "objective-mapping", requestCoworker: routePacket }],
      escalations: [],
      unroutable: [],
    });
    ports.loadObjectiveMappingHistory.mockResolvedValue(ok({ history: [{
      taskRunId: "TR-MCP-PRIOR",
      status: "input-required",
      targetAgent: routePacket.targetAgent,
      objective: routePacket.objective,
      questionPacketSummary: routePacket.questionPacketSummary,
      idempotencyKey: `initiative-readiness:BI-TERMINAL:objective-mapping:${headSha}`,
      requiredToolNames: routePacket.requiredToolNames,
      binding: {
        writerToolName: "record_initiative_evidence",
        itemId: "BI-TERMINAL",
        gate: "objective-mapping",
        expectedCurrentBaselineId: "baseline-current",
        artifactRef: routePacket.initiativeReviewBinding.artifactRef,
      },
      actionEnvelopeStatuses: ["approved"],
      writerExecutions: [{ success: false, hasReceipt: false }],
    }] }));

    const result = await resolveTerminalInitiativeRecovery({
      decision,
      currentAgentId: "AGT-CALLER",
      refusedWorkroomId: null,
      ports,
    });
    expect(result.reviewerRoutes).toEqual([]);
    expect(result.escalations).toMatchObject([{
      reason: "objective-mapping-prior-authority-active",
      nextAction: expect.stringContaining("TR-MCP-PRIOR"),
    }]);
  });

  it("releases the exact Pet Rescue legacy identity only after an ancestor-bound provider blob mismatch", async () => {
    const legacyBaseline = {
      baselineId: "baseline-ancestor",
      supersedesBaselineId: null,
      artifactRef: {
        kind: "repo-blob-at-commit" as const,
        repositoryFullName: room.repositoryFullName,
        commitSha: "6".repeat(40),
        path: "docs/superpowers/specs/design.md",
        providerBlobId: "7".repeat(40),
      },
    };
    const current = {
      baselineId: "baseline-current",
      supersedesBaselineId: "baseline-ancestor",
      artifactRef: {
        kind: "repo-blob-at-commit" as const,
        repositoryFullName: room.repositoryFullName,
        commitSha: baselineCommitSha,
        path: "docs/superpowers/specs/design.md",
        providerBlobId: "3".repeat(40),
      },
    };
    const ports = deps([room], [legacyBaseline, current]);
    ports.loadObjectiveMappingHistory.mockResolvedValue(ok({ history: [{
      taskRunId: "TR-MCP-PET-LEGACY",
      status: "input-required",
      targetAgent: "AGT-WS-PORTFOLIO",
      objective: `For BI-TERMINAL in ${room.capsuleId} on ${room.repositoryFullName}#${room.headBranch} at Workroom head ${headSha}, address objective-mapping using record_initiative_evidence.`,
      questionPacketSummary: `objective-mapping for BI-TERMINAL at ${headSha.slice(0, 12)}`,
      idempotencyKey: `initiative-readiness:BI-TERMINAL:objective-mapping:${headSha}`,
      requiredToolNames: ["record_initiative_evidence", "read_source_at_version"],
      binding: {
        writerToolName: "record_initiative_evidence",
        itemId: "BI-TERMINAL",
        gate: "objective-mapping",
        expectedCurrentBaselineId: "baseline-ancestor",
        artifactRef: {
          ...legacyBaseline.artifactRef,
          commitSha: headSha,
        },
      },
      actionEnvelopeStatuses: [],
      // The five live failures were immutable reader executions. They remain
      // auditable but are not writer authority and must never be projected as
      // record_initiative_evidence history.
      writerExecutions: [],
    }] }));
    ports.verifyHistoricalArtifact.mockResolvedValue({
      ok: false,
      code: "IMMUTABLE_BLOB_MISMATCH",
      error: "Repository provider blob identity does not match the requested locator.",
    });

    const result = await resolveTerminalInitiativeRecovery({
      decision,
      currentAgentId: "AGT-CALLER",
      refusedWorkroomId: null,
      ports,
    });

    expect(ports.verifyHistoricalArtifact).toHaveBeenCalledWith({
      repositoryFullName: room.repositoryFullName,
      commitSha: headSha,
      path: legacyBaseline.artifactRef.path,
      expectedBlobId: legacyBaseline.artifactRef.providerBlobId,
    });
    expect(result.reviewerRoutes).toMatchObject([{ gate: "objective-mapping" }]);
  });

  it.each([
    ["provider unavailable", { ok: false, code: "IMMUTABLE_SOURCE_UNAVAILABLE", error: "provider timeout" }, "objective-mapping-history-unavailable"],
    ["valid stale artifact", ok(new Uint8Array([1])), "objective-mapping-identity-conflict"],
  ])("fails closed for a %s historical artifact", async (_label, verification, reason) => {
    const legacyBaseline = {
      baselineId: "baseline-ancestor",
      supersedesBaselineId: null,
      artifactRef: {
        kind: "repo-blob-at-commit" as const,
        repositoryFullName: room.repositoryFullName,
        commitSha: "6".repeat(40),
        path: "docs/superpowers/specs/design.md",
        providerBlobId: "7".repeat(40),
      },
    };
    const current = {
      baselineId: "baseline-current",
      supersedesBaselineId: "baseline-ancestor",
      artifactRef: {
        kind: "repo-blob-at-commit" as const,
        repositoryFullName: room.repositoryFullName,
        commitSha: baselineCommitSha,
        path: "docs/superpowers/specs/design.md",
        providerBlobId: "3".repeat(40),
      },
    };
    const ports = deps([room], [legacyBaseline, current]);
    ports.loadObjectiveMappingHistory.mockResolvedValue(ok({ history: [{
      taskRunId: "TR-MCP-PET-LEGACY",
      status: "input-required",
      targetAgent: "AGT-WS-PORTFOLIO",
      objective: `For BI-TERMINAL in ${room.capsuleId} on ${room.repositoryFullName}#${room.headBranch} at Workroom head ${headSha}, address objective-mapping using record_initiative_evidence.`,
      questionPacketSummary: `objective-mapping for BI-TERMINAL at ${headSha.slice(0, 12)}`,
      idempotencyKey: `initiative-readiness:BI-TERMINAL:objective-mapping:${headSha}`,
      requiredToolNames: ["record_initiative_evidence", "read_source_at_version"],
      binding: {
        writerToolName: "record_initiative_evidence",
        itemId: "BI-TERMINAL",
        gate: "objective-mapping",
        expectedCurrentBaselineId: "baseline-ancestor",
        artifactRef: { ...legacyBaseline.artifactRef, commitSha: headSha },
      },
      actionEnvelopeStatuses: [],
      writerExecutions: [],
    }] }));
    ports.verifyHistoricalArtifact.mockResolvedValue(verification);

    const result = await resolveTerminalInitiativeRecovery({
      decision,
      currentAgentId: "AGT-CALLER",
      refusedWorkroomId: null,
      ports,
    });

    expect(result.reviewerRoutes).toEqual([]);
    expect(result.escalations).toMatchObject([{ reason }]);
  });

  it("does not query or release an artifact whose claimed baseline is not a retained ancestor", async () => {
    const current = {
      baselineId: "baseline-current",
      supersedesBaselineId: null,
      artifactRef: {
        kind: "repo-blob-at-commit" as const,
        repositoryFullName: room.repositoryFullName,
        commitSha: baselineCommitSha,
        path: "docs/superpowers/specs/design.md",
        providerBlobId: "3".repeat(40),
      },
    };
    const ports = deps([room], [current]);
    ports.loadObjectiveMappingHistory.mockResolvedValue(ok({ history: [{
      taskRunId: "TR-MCP-UNRETAINED",
      status: "input-required",
      targetAgent: "AGT-WS-PORTFOLIO",
      objective: `For BI-TERMINAL in ${room.capsuleId} on ${room.repositoryFullName}#${room.headBranch} at Workroom head ${headSha}, address objective-mapping using record_initiative_evidence.`,
      questionPacketSummary: `objective-mapping for BI-TERMINAL at ${headSha.slice(0, 12)}`,
      idempotencyKey: `initiative-readiness:BI-TERMINAL:objective-mapping:${headSha}`,
      requiredToolNames: ["record_initiative_evidence", "read_source_at_version"],
      binding: {
        writerToolName: "record_initiative_evidence",
        itemId: "BI-TERMINAL",
        gate: "objective-mapping",
        expectedCurrentBaselineId: "baseline-not-retained",
        artifactRef: {
          ...current.artifactRef,
          commitSha: headSha,
          providerBlobId: "7".repeat(40),
        },
      },
      actionEnvelopeStatuses: [],
      writerExecutions: [],
    }] }));

    const result = await resolveTerminalInitiativeRecovery({
      decision,
      currentAgentId: "AGT-CALLER",
      refusedWorkroomId: null,
      ports,
    });

    expect(ports.verifyHistoricalArtifact).not.toHaveBeenCalled();
    expect(result.reviewerRoutes).toEqual([]);
    expect(result.escalations).toMatchObject([{ reason: "objective-mapping-identity-conflict" }]);
  });

  it("fails closed when the current baseline has no eligible post-baseline passing evidence", async () => {
    const ports = deps();
    ports.loadEligibleEvidenceActivityIds.mockResolvedValue(ok({ activityIds: [] }));

    const result = await resolveTerminalInitiativeRecovery({
      decision,
      currentAgentId: "AGT-CALLER",
      refusedWorkroomId: null,
      ports,
    });

    expect(result.reviewerRoutes).toEqual([]);
    expect(result.escalations).toMatchObject([{ reason: "eligible-evidence-not-found" }]);
    expect(ports.resolveRecovery).not.toHaveBeenCalled();
  });

  it("fails closed when the post-baseline evidence inventory cannot be bounded", async () => {
    const ports = deps();
    ports.loadEligibleEvidenceActivityIds.mockResolvedValue(err("evidence-limit-exceeded"));

    const result = await resolveTerminalInitiativeRecovery({
      decision,
      currentAgentId: "AGT-CALLER",
      refusedWorkroomId: null,
      ports,
    });

    expect(result.reviewerRoutes).toEqual([]);
    expect(result.escalations).toMatchObject([{ reason: "eligible-evidence-unbounded" }]);
    expect(ports.resolveRecovery).not.toHaveBeenCalled();
  });

  it("uses the provider-verified artifact already pinned by the current baseline", async () => {
    const ports = deps([room], [{
      baselineId: "baseline-current",
      supersedesBaselineId: null,
      artifactRef: {
        kind: "repo-blob-at-commit",
        repositoryFullName: room.repositoryFullName,
        commitSha: baselineCommitSha,
        path: "docs/superpowers/specs/pinned-design.md",
        providerBlobId: "4".repeat(40),
      },
    }]);
    await resolveTerminalInitiativeRecovery({ decision, currentAgentId: null, refusedWorkroomId: room.capsuleId, ports });

    expect(ports.discoverArtifact).not.toHaveBeenCalled();
    expect(ports.resolveRecovery).toHaveBeenCalledWith(expect.objectContaining({
      canonicalArtifact: {
        resolved: true,
        commitSha: baselineCommitSha,
        path: "docs/superpowers/specs/pinned-design.md",
        providerBlobId: "4".repeat(40),
      },
      expectedCurrentBaselineId: "baseline-current",
    }));
  });

  it.each([
    ["missing", [], "workroom-not-found"],
    ["ambiguous", [room, { ...room, capsuleId: "WC-OTHER" }], "workroom-ambiguous"],
  ])("fails closed for %s workroom identity", async (_label, rooms, reason) => {
    const ports = deps(rooms);
    const result = await resolveTerminalInitiativeRecovery({ decision, currentAgentId: null, refusedWorkroomId: null, ports });

    expect(result.reviewerRoutes).toEqual([]);
    expect(result.escalations).toMatchObject([{ reason }]);
    expect(ports.discoverArtifact).not.toHaveBeenCalled();
    expect(ports.resolveRecovery).not.toHaveBeenCalled();
  });

  it("fails closed when the baseline chain has no unique head", async () => {
    const ports = deps([room], [
      { baselineId: "baseline-a", supersedesBaselineId: null },
      { baselineId: "baseline-b", supersedesBaselineId: null },
    ]);
    const result = await resolveTerminalInitiativeRecovery({ decision, currentAgentId: null, refusedWorkroomId: room.capsuleId, ports });

    expect(result.reviewerRoutes).toEqual([]);
    expect(result.escalations).toMatchObject([{ reason: "baseline-ambiguous" }]);
    expect(ports.discoverArtifact).not.toHaveBeenCalled();
  });
});
