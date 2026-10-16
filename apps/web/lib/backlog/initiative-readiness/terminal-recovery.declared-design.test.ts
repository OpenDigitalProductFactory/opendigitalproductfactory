import { describe, expect, it, vi } from "vitest";
import { resolveInitiativeReviewerRecovery } from "@/lib/tak/initiative-readiness-tool-grants";
import { readinessRequirement } from "./readiness-guidance";
import type { InitiativeReadinessDecision } from "./types";
import { resolveTerminalInitiativeRecovery } from "./terminal-recovery";
import { discoverCanonicalDesignArtifact } from "./canonical-artifact-discovery";

const headSha = "2".repeat(40);
const room = { capsuleId: "WC-TERMINAL", backlogItemId: "BI-TERMINAL",
  repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
  baseSha: headSha, headBranch: "fix/terminal", headSha, isLive: true };
const decision: InitiativeReadinessDecision = {
  decisionId: "IRD-DECLARED-DESIGN", policyVersion: "initiative-readiness.v3",
  subject: { kind: "backlog-item", id: "BI-TERMINAL" },
  transitionObject: { kind: "backlog-item", id: "BI-TERMINAL", expectedVersion: "open", targetState: "implementation" },
  profile: "feature", target: "implementation", verdict: "input-required",
  satisfied: [], unmet: [], blockers: [], evaluatedAt: "2026-10-15T17:50:00Z",
};

function deps(rooms = [room], baselines: unknown[] = []) {
  return { loadLiveRooms: vi.fn(async () => rooms), loadBaselinePayloads: vi.fn(async () => baselines),
    loadEligibleEvidenceActivityIds: vi.fn(), loadObjectiveMappingHistory: vi.fn(), verifyHistoricalArtifact: vi.fn(),
    loadPlanArtifact: vi.fn(async () => ({ resolved: false as const, nextAction: "Plan review is not owed by this case." })) };
}

describe("declared design packet revalidation", () => {
  it("revalidates the exact claim packet for an unchanged design declared by the live item", async () => {
    const path = "docs/superpowers/specs/existing-design.md";
    const backlogBody = `Design: \`${path}\``;
    let liveBody = backlogBody;
    const unchangedRoom = { ...room, baseSha: headSha };
    const feature: InitiativeReadinessDecision = { ...decision, target: "implementation", profile: "feature",
      unmet: [readinessRequirement({ code: "CANONICAL_DESIGN_REQUIRED", state: "missing", accountableRole: "design-checklist-reviewer" })] };
    const provider = vi.fn(async (url: string | URL | Request) => new Response(JSON.stringify(
      String(url).includes("/contents/") ? { type: "file", path, sha: "3".repeat(40) } : { files: [] },
    ), { status: 200 }));
    const providerDb = { credentialEntry: { findUnique: vi.fn(async () => null) },
      platformDevConfig: { findUnique: vi.fn(async () => ({ upstreamRemoteUrl: null })) } };
    const discover = (input: Parameters<typeof discoverCanonicalDesignArtifact>[0]) => discoverCanonicalDesignArtifact({
      ...input, db: providerDb as never, fetchImpl: provider as typeof fetch,
    });
    const grants = { agentToolGrant: { findMany: vi.fn(async () => ["initiative_design_review", "file_read"].map(grantKey => ({
      grantKey, agent: { agentId: "AGT-REVIEWER", displayName: "Independent reviewer", status: "active", archived: false, lifecycleStage: "production" },
    }))) } };
    const ports = { ...deps([unchangedRoom], []), loadBacklogBody: vi.fn(async () => liveBody),
      discoverArtifact: vi.fn(discover),
      resolveRecovery: (input: Parameters<typeof resolveInitiativeReviewerRecovery>[0]) => resolveInitiativeReviewerRecovery({ ...input, db: grants }),
    };
    // The claim issuer already passes the live item's declaration to this reader.
    const claimedArtifact = await discover({ repositoryFullName: room.repositoryFullName, baseSha: headSha, headSha, backlogBody });
    expect(claimedArtifact.resolved).toBe(true);
    if (!claimedArtifact.resolved) throw new Error("claim artifact must resolve");
    const issued = await ports.resolveRecovery({ decision: feature, currentAgentId: "AGT-AUTHOR", db: grants,
      dispatchContext: { workroomId: room.capsuleId, repositoryFullName: room.repositoryFullName, branchName: room.headBranch, headSha },
      canonicalArtifact: { resolved: true, ...claimedArtifact.artifact }, expectedCurrentBaselineId: null });
    expect(issued.reviewerRoutes).toHaveLength(1);
    const revalidated = await resolveTerminalInitiativeRecovery({ decision: feature, currentAgentId: "AGT-AUTHOR",
      refusedWorkroomId: room.capsuleId, ports });
    expect(revalidated.reviewerRoutes.map(route => route.requestCoworker))
      .toEqual(issued.reviewerRoutes.map(route => route.requestCoworker));
    for (liveBody of ["", "Design: `docs/superpowers/specs/other.md`", `${backlogBody} and docs/superpowers/specs/other.md`]) {
      const changed = await resolveTerminalInitiativeRecovery({ decision: feature, currentAgentId: "AGT-AUTHOR",
        refusedWorkroomId: room.capsuleId, ports });
      expect(changed.reviewerRoutes).toEqual([]);
    }
  });
});

