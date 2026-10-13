import { describe, expect, it, vi } from "vitest";
import { ok } from "@/lib/shared/action-result";
import { bodyCriteriaVersion } from "./body-baseline-version";
import { bodyBaselineInputsMatch } from "./body-baseline-binding";
import { readinessRequirement } from "./readiness-guidance";
import { resolveTerminalInitiativeRecovery, type TerminalRecoveryPorts } from "./terminal-recovery";
import { resolveInitiativeReviewerRecovery } from "@/lib/tak/initiative-readiness-tool-grants";
import type { InitiativeReadinessDecision } from "./types";

const repositoryFullName = "owner/repo";
const body = "## Acceptance\n- Verify canonical grants.";
const room = { capsuleId: "WC-CASE", backlogItemId: "BI-CAP-437F7745", repositoryFullName,
  baseSha: "a".repeat(40), headSha: "b".repeat(40), headBranch: "fix/delivered", isLive: true };
const artifactRef = { kind: "document-version" as const, repositoryFullName, versionId: "version-1", valueDigest: "sha256:version" };
const baseline = { baselineId: "baseline-1", supersedesBaselineId: null, origin: "item-body", authorAgentId: "AGT-AUTHOR",
  subject: { kind: "backlog-item", id: room.backlogItemId }, authoritySnapshot: { organizationId: "platform" },
  criteriaDigest: bodyCriteriaVersion(body)!.criteriaDigest, sourceIdentity: { repositoryFullName, headSha: room.headSha }, artifactRef };
const decision: InitiativeReadinessDecision = {
  decisionId: "IRD-CASE", policyVersion: "initiative-readiness.v3", subject: { kind: "backlog-item", id: room.backlogItemId },
  transitionObject: { kind: "backlog-item", id: room.backlogItemId, expectedVersion: "awaiting-acceptance", targetState: "done" },
  profile: "fix", shapeDecision: { declared: "medium", effective: "medium", sensitivity: null, raised: false },
  target: "completion", verdict: "input-required", satisfied: [], blockers: [],
  unmet: [readinessRequirement({ code: "ACCEPTANCE_EVIDENCE_REQUIRED", state: "missing", accountableRole: "acceptance-reviewer" })],
  evaluatedAt: "2026-10-13T04:21:29Z",
};
function ports(options: { currentBody?: string; head?: string; evidence?: string[]; independent?: boolean; readerGrant?: boolean; roomAdmission?: boolean } = {}): TerminalRecoveryPorts {
  const holders = ["AGT-AUTHOR", ...(options.independent === false ? [] : ["AGT-INDEPENDENT"])].flatMap((agentId) =>
    ["initiative_evidence_write", ...(options.readerGrant === false ? [] : ["file_read"])].map((grantKey) => ({ grantKey,
      agent: { agentId, displayName: agentId, status: "active", archived: false, lifecycleStage: "production" } })));
  return {
    loadLiveRooms: async () => [{ ...room, headSha: options.head ?? room.headSha }],
    loadBaselinePayloads: async () => [baseline],
    bodyReviewerCanRead: async () => options.roomAdmission !== false,
    validateBodyBaselineCurrent: async ({ baseline: current, room: live }) => bodyBaselineInputsMatch(current, {
      itemId: room.backlogItemId, organizationId: null, body: options.currentBody ?? body,
      binding: { itemId: room.backlogItemId, gate: "objective-mapping", writerToolName: "record_initiative_evidence",
        expectedCurrentBaselineId: current.baselineId, artifactRef, workroomRef: { kind: "workroom-head", workroomId: live.capsuleId,
          repositoryFullName, branchName: live.headBranch!, headSha: live.headSha! } },
    }),
    loadEligibleEvidenceActivityIds: async () => ok({ activityIds: options.evidence ?? ["E-1"] }),
    loadObjectiveMappingHistory: async () => ok({ history: [] }),
    verifyHistoricalArtifact: vi.fn(), discoverArtifact: vi.fn(), loadPlanArtifact: vi.fn(),
    resolveRecovery: (input) => resolveInitiativeReviewerRecovery({ ...input, db: { agentToolGrant: { findMany: async () => holders } } }),
  };
}
const recover = (options: Parameters<typeof ports>[0] = {}) => resolveTerminalInitiativeRecovery({ decision, currentUserId: "user", currentAgentId: "AGT-AUTHOR", refusedWorkroomId: room.capsuleId, ports: ports(options) });
describe("medium product-linked body acceptance recovery", () => {
  it("issues one executable independent route and reuses its exact identity on retry", async () => {
    const first = await recover();
    const second = await recover();
    expect(first.escalations).toEqual([]);
    expect(first.reviewerRoutes).toHaveLength(1);
    expect(first.reviewerRoutes[0]).toMatchObject({ independent: true, gate: "objective-mapping", targetAgentId: "AGT-INDEPENDENT",
      requestCoworker: { requiredToolNames: ["record_initiative_evidence", "read_source_at_version"],
        initiativeReviewBinding: { artifactRef, expectedCurrentBaselineId: "baseline-1", eligibleEvidenceActivityIds: ["E-1"] } } });
    expect(second.reviewerRoutes[0]!.requestCoworker).toEqual(first.reviewerRoutes[0]!.requestCoworker);
  });
  it.each([{ currentBody: "## Acceptance\n- Changed criteria." }, { head: "c".repeat(40) }])("refuses stale criteria or source", async (options) => {
    const result = await recover(options);
    expect(result.reviewerRoutes).toEqual([]);
    expect(result.escalations).toMatchObject([{ reason: "baseline-stale" }]);
  });
  it("requires fresh eligible evidence after the retained baseline", async () => {
    const result = await recover({ evidence: [] });
    expect(result.reviewerRoutes).toEqual([]);
    expect(result.escalations).toMatchObject([{ reason: "eligible-evidence-not-found" }]);
  });
  it.each([{ independent: false }, { readerGrant: false }, { roomAdmission: false }])("never dispatches an author or a reviewer missing grant/admission", async (options) => {
    const result = await recover(options);
    expect(result.reviewerRoutes).toEqual([]);
    expect(result.escalations).toMatchObject([{ reason: "no-eligible-reviewer" }]);
  });
});
