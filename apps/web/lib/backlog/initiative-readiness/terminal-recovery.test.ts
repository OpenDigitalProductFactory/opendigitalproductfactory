import { describe, expect, it, vi } from "vitest";

import { readinessRequirement } from "./readiness-guidance";
import type { InitiativeReadinessDecision } from "./types";
import { resolveTerminalInitiativeRecovery } from "./terminal-recovery";

const baseSha = "1".repeat(40);
const headSha = "2".repeat(40);
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
    discoverArtifact: vi.fn().mockResolvedValue({
      resolved: true,
      artifact: { path: "docs/superpowers/specs/design.md", providerBlobId: "3".repeat(40) },
    }),
    resolveRecovery: vi.fn().mockResolvedValue({ reviewerRoutes: [{ gate: "objective-mapping" }], escalations: [], unroutable: [] }),
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
    }));
    expect(result.reviewerRoutes).toEqual([{ gate: "objective-mapping" }]);
  });

  it("uses the provider-verified artifact already pinned by the current baseline", async () => {
    const ports = deps([room], [{
      baselineId: "baseline-current",
      supersedesBaselineId: null,
      artifactRef: {
        kind: "repo-blob-at-commit",
        repositoryFullName: room.repositoryFullName,
        path: "docs/superpowers/specs/pinned-design.md",
        providerBlobId: "4".repeat(40),
      },
    }]);
    await resolveTerminalInitiativeRecovery({ decision, currentAgentId: null, refusedWorkroomId: room.capsuleId, ports });

    expect(ports.discoverArtifact).not.toHaveBeenCalled();
    expect(ports.resolveRecovery).toHaveBeenCalledWith(expect.objectContaining({
      canonicalArtifact: {
        resolved: true,
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
