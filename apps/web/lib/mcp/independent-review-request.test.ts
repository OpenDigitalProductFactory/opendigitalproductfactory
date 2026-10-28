const recoveryTarget = vi.hoisted(() => vi.fn());
vi.mock("@/lib/mcp-task-review-recovery", () => ({ issueOriginalReviewRecoveryTarget: recoveryTarget }));
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ agent: vi.fn(), token: vi.fn(), room: vi.fn(), rooms: vi.fn(), snapshots: vi.fn(),
  human: vi.fn(), currentConsent: vi.fn(), access: vi.fn(), item: vi.fn(), recovery: vi.fn(),
  task: vi.fn(), authorityKey: vi.fn(), outcome: vi.fn(), itemRow: vi.fn(), alias: vi.fn(), buildStudioRoutes: vi.fn(),
  preflight: vi.fn(), presentIssuer: vi.fn() }));
vi.mock("@/lib/mcp-task-review-reassessment", async original => ({ ...await original<typeof import("@/lib/mcp-task-review-reassessment")>(),
  issuePresentReassessmentRequest: mocks.presentIssuer }));
vi.mock("@dpf/db", () => ({ prisma: {
  agent: { findUnique: mocks.agent }, mcpApiToken: { findUnique: mocks.token },
  workroom: { findFirst: mocks.room, findMany: mocks.rooms }, contributorInventorySnapshot: { findMany: mocks.snapshots },
  taskRun: { findFirst: mocks.task },
  backlogItem: { findUnique: mocks.itemRow },
  principalAlias: { findFirst: mocks.alias },
} }));
vi.mock("@/lib/backlog/initiative-readiness/build-studio-owed-routes", () => ({
  BUILD_STUDIO_ASSISTANT_AGENT_ID: "AGT-WS-BUILD", buildStudioOwedRoutes: mocks.buildStudioRoutes }));
vi.mock("@/lib/auth/oauth-task-authority", () => ({ resolveMcpTaskAuthorityKey: mocks.authorityKey }));
vi.mock("@/lib/mcp-task-review-outcome", () => ({ loadTaskInitiativeReviewOutcome: mocks.outcome }));
vi.mock("@/lib/govern/current-user-context", () => ({ currentUserContext: mocks.human }));
vi.mock("@/lib/auth/oauth-tokens", () => ({ OAUTH_EXECUTION_AUTHORITY_SELECT: {}, isCurrentOAuthExecutionAuthority: mocks.currentConsent }));
const humanAccess = vi.hoisted(() => vi.fn());
vi.mock("@/lib/work-management/workroom-agent-access.server", () => ({ resolveAgentWorkroomAccess: mocks.access,
  resolveHumanWorkroomAccess: humanAccess }));
vi.mock("./packs/backlog-pack-read-tools", () => ({ getBacklogItem: mocks.item }));
vi.mock("@/lib/backlog/initiative-readiness/terminal-recovery", () => ({ resolveTerminalInitiativeRecovery: mocks.recovery }));
// This suite isolates authorization and exact issuance. The companion document
// suite exercises the real parser and preflight after these checks succeed.
vi.mock("@/lib/mcp-task-review-document", () => ({ reviewDocumentPreflight: mocks.preflight }));

import { authorizeCoworkerRequest } from "./independent-review-request";
import type { ToolExecutionContext } from "@/lib/mcp-tool-types";
import { deterministicExternalTaskRunId, remoteTaskRequestDigest } from "@/lib/mcp-task-capacity-contract";
import type { InitiativeReviewBinding } from "@/lib/mcp-task-review-contract";
import { resolveInitiativeReviewerRecovery } from "@/lib/tak/initiative-readiness-tool-grants";
import { createExhaustedPlanReviewPredicate } from "@/lib/backlog/initiative-readiness/exhausted-plan-review";
import { readinessRequirement } from "@/lib/backlog/initiative-readiness/readiness-guidance";
import type { InitiativeReadinessDecision } from "@/lib/backlog/initiative-readiness/types";
import { designPhaseReviewDecision } from "@/lib/backlog/initiative-readiness/design-phase-recovery";
import { boundedBacklogRecoveryRead } from "./backlog-recovery-read";
import { createPullRequestObservation } from "@/lib/contributor-change-lanes/pull-request-observation";
import { projectBacklogItemReadiness } from "@/lib/backlog/initiative-readiness/entry-adapter";
import { baseline as approvedScope, item as readinessItem, readyActivities } from "@/lib/backlog/initiative-readiness/entry-adapter.test-fixtures";
import { presentReassessmentPacket } from "@/lib/mcp-task-review-reassessment";

const binding: InitiativeReviewBinding = { writerToolName: "record_initiative_post_implementation_review", itemId: "BI-TEST", gate: "post-implementation-review",
  expectedCurrentBaselineId: null,
  workroomRef: { kind: "workroom-head", workroomId: "WC-TEST", repositoryFullName: "org/repo", branchName: "fix/test", headSha: "a".repeat(40) },
  artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "org/repo", commitSha: "a".repeat(40), path: "src/test.ts", providerBlobId: "b".repeat(40) } };
const packet = { targetAgent: "AGT-REVIEWER", objective: "Review the exact repair", questionPacketSummary: "Independent repair review",
  requestKey: "review:immutable", tier: 2, enteredVia: "handoff",
  requiredToolNames: ["read_source_at_version", binding.writerToolName], initiativeReviewBinding: binding };
const context: ToolExecutionContext = { agentId: "AGT-AUTHOR", apiTokenId: "access-1", authSource: "oauth",
  tokenScope: "write", tokenGrantScopes: ["initiative_evidence_write"], userContext: { isSuperuser: true, platformRole: null } };

beforeEach(() => {
  vi.resetAllMocks();
  recoveryTarget.mockResolvedValue({ kind: "none" });
  mocks.agent.mockResolvedValue({ status: "active", archived: false, toolGrants: [{ grantKey: "initiative_evidence_write" }] });
  mocks.token.mockResolvedValue({ userId: "human", agentId: "AGT-AUTHOR", authorityBindingId: "consent", oauthClient: { registrationKind: "dynamic" } });
  mocks.currentConsent.mockResolvedValue(true);
  mocks.human.mockResolvedValue({ isSuperuser: true, platformRole: null });
  mocks.room.mockResolvedValue({ id: "room-row", backlogItemId: "BI-TEST", executorKind: "claude-desktop", requestedByPrincipalId: "prn-human",
    repositoryFullName: "org/repo", headBranch: "fix/test", baseSha: "c".repeat(40), headSha: "a".repeat(40) });
  mocks.itemRow.mockResolvedValue({ id: "cuid-item" });
  mocks.alias.mockResolvedValue({ principalId: "prn-human" });
  mocks.access.mockResolvedValue({ decision: { level: "action" } });
  mocks.item.mockResolvedValue({ success: true, data: { readiness: { decisions: { completion: {
    verdict: "input-required", subject: { id: "BI-TEST" }, unmet: [], blockers: [],
  } } } } });
  mocks.recovery.mockResolvedValue({ reviewerRoutes: [{ independent: true, requestCoworker: packet }] });
  mocks.authorityKey.mockResolvedValue("oauth-family:consent-family");
  mocks.task.mockResolvedValue(null);
  mocks.preflight.mockResolvedValue({ refusal: null, notice: null });
});

describe("consent-bound independent review request", () => {
  it.each(["fresh", "already-allocated", "mixed-original-recovery"])("roundtrips the exact present packet for %s without using original replay authority", async scenario => {
    const design = { ...packet, initiativeReviewBinding: { ...binding, itemId: "BI-285EF102", writerToolName: "record_initiative_design_review", gate: "design-spec" },
      requiredToolNames: ["read_source_at_version", "record_initiative_design_review"] };
    const proof = { authorizationItemId: "BI-7906C73E", baselineId: "baseline-current", policyDigest: "c".repeat(64), authorityArtifact: binding.artifactRef,
      policy: { subjectItemId: "BI-285EF102" } };
    const originals = [{ gate: "design-spec", taskRunId: "TR-ORIGINAL", requestDigest: "d".repeat(64), readback: { binding: { artifactRef: binding.artifactRef } } }];
    const issue = (source: Record<string, unknown>) => presentReassessmentPacket({ packet: source, proof: proof as never, originals: originals as never });
    const present = issue(design);
    mocks.presentIssuer.mockImplementation(async ({ packet: source }) => issue(source));
    mocks.room.mockResolvedValue({ ...await mocks.room(), backlogItemId: "BI-285EF102" });
    const implementation = { target: "implementation", verdict: "input-required", subject: { id: "BI-285EF102" }, blockers: [],
      unmet: [{ code: "CANONICAL_DESIGN_REQUIRED", accountableRole: "design-checklist-reviewer" }] };
    mocks.item.mockResolvedValue({ success: true, data: { readiness: { decisions: { implementation } } } });
    mocks.recovery.mockResolvedValue({ reviewerRoutes: [{ independent: true, requestCoworker: design }] });
    recoveryTarget.mockResolvedValue({ kind: "refused", reason: "original-review-not-safely-resumable" });
    if (scenario !== "fresh") {
      const digest = remoteTaskRequestDigest({ agentId: present.targetAgent, routeContext: "/build", title: present.questionPacketSummary,
        objective: present.objective, prompt: present.objective, idempotencyKey: present.requestKey, riskClass: "bounded-write", collaborationKind: "handoff",
        authorityScope: [...context.tokenGrantScopes!, "backlog-item:BI-285EF102", ...design.requiredToolNames.map(name => `tool:${name}`)],
        initiativeReviewBinding: present.initiativeReviewBinding } as never);
      mocks.task.mockResolvedValue({ a2aMetadata: { requestDigestVersion: 2, requestDigest: digest } });
    }
    if (scenario === "mixed-original-recovery") {
      mocks.outcome.mockResolvedValue({ summary: "Existing genuine receipt" });
      const result = await authorizeCoworkerRequest({ ...present, reviewRecovery: { taskRunId: "TR-MCP-original", requestDigest: "d".repeat(64),
        expectedUpdatedAt: new Date().toISOString() } }, "human", context);
      expect(result.refusal).toMatchObject({ success: false, error: "independent_review_request_denied" });
      expect(mocks.outcome).not.toHaveBeenCalled();
    } else expect(await authorizeCoworkerRequest(present, "human", context)).toEqual({ bounded: true });
    expect(recoveryTarget).not.toHaveBeenCalled();
  });
  it.each([{ repositoryFullName: "other/repo" }, { headBranch: "fix/other" },
    { headSha: "f".repeat(40) }, { baseSha: "invalid" }, { headSha: null }, { backlogItemId: "BI-FOREIGN" }])(
    "refuses a foreign or changed persisted room before readiness %j", async change => {
      mocks.room.mockResolvedValue({ ...await mocks.room(), ...change });
      expect((await authorizeCoworkerRequest(packet, "human", context)).refusal?.success).toBe(false);
      expect(mocks.item).not.toHaveBeenCalled();
      expect(mocks.preflight).not.toHaveBeenCalled();
    });
  it.each([true, false])("requires verified source proof for the status-only archived author (valid=%s)", async validProof => {
    const author = { id: "room-row", capsuleId: "WC-TEST", backlogItemId: "BI-TEST", executorKind: "codex-desktop",
      requestedByPrincipalId: "prn-human", featureBuild: null, repositoryFullName: "org/repo",
      headBranch: "fix/test", headSha: "a".repeat(40), baseSha: "b".repeat(40), createdByPrincipalId: "author",
      status: "archived", archivedAt: null, createdAt: new Date("2026-10-15T06:00:00Z"), pullRequestNumber: 6265 };
    mocks.room.mockImplementation(async ({ where }) => where.archivedAt === null && where.status?.not === "archived" ? null : author);
    mocks.rooms.mockImplementation(async ({ where }) => where.archivedAt === null ? [] : [author]);
    mocks.snapshots.mockResolvedValue([{ payload: createPullRequestObservation({ repositoryFullName: "org/repo",
      number: 6265, url: "https://github.com/org/repo/pull/6265", title: "repair", headBranch: author.headBranch,
      headSha: author.headSha, state: "merged", isDraft: false, mergeStateStatus: null, mergeCommitSha: "c".repeat(40),
      mergedAt: "2026-10-16T05:00:00Z", providerUpdatedAt: "2026-10-16T05:00:00Z", observedAt: "2026-10-16T05:01:00Z" }) }]);
    const bodyPacket = { ...packet, requiredToolNames: ["read_source_at_version", "record_initiative_evidence"],
      initiativeReviewBinding: { ...binding, gate: "objective-mapping", writerToolName: "record_initiative_evidence",
        expectedCurrentBaselineId: "baseline-body", eligibleEvidenceActivityIds: ["E-1"],
        artifactRef: { kind: "document-version", repositoryFullName: "org/repo", versionId: "version-body", valueDigest: "sha256:body" } } };
    mocks.recovery.mockResolvedValue({ reviewerRoutes: [{ independent: true, requestCoworker: bodyPacket }] });
    if (!validProof) mocks.snapshots.mockResolvedValue([]);
    const result = await authorizeCoworkerRequest(bodyPacket, "human", context);
    if (validProof) expect(result).toEqual({ bounded: true });
    else expect(result.refusal).toBeDefined();
    mocks.access.mockResolvedValue({ decision: { level: "none" } });
    expect((await authorizeCoworkerRequest(bodyPacket, "human", context)).refusal).toBeDefined();
  });
  it("accepts the completion issuer's exact covered-plan packet without admitting xlarge implementation", async () => {
    const implementation: InitiativeReadinessDecision = {
      decisionId: "IRD-DECOMPOSED-PARENT", policyVersion: "initiative-readiness.v3", subject: { kind: "backlog-item", id: "BI-TEST" },
      transitionObject: { kind: "work-capsule", id: "WC-TEST", expectedVersion: "claim.v1", targetState: "implementation" },
      profile: "feature", target: "implementation", verdict: "denied", satisfied: [], unmet: [],
      blockers: [readinessRequirement({ code: "DECOMPOSITION_REQUIRED", state: "fail", accountableRole: "portfolio-owner" })],
      shapeDecision: { declared: "xlarge", effective: "xlarge", sensitivity: "low", raised: false, trigger: null },
      evaluatedAt: "2026-10-15T20:56:18Z",
    };
    const completion: InitiativeReadinessDecision = { ...implementation, target: "completion", verdict: "input-required", blockers: [], unmet: [
      readinessRequirement({ code: "PLAN_REVIEW_REQUIRED", state: "missing", accountableRole: "plan-reviewer" }),
      readinessRequirement({ code: "OBJECTIVE_RECONCILIATION_REQUIRED", state: "missing", accountableRole: "acceptance-reviewer" }),
    ] };
    const issue = (decision: InitiativeReadinessDecision) => resolveInitiativeReviewerRecovery({
      decision, currentAgentId: "AGT-AUTHOR", expectedCurrentBaselineId: "BASE-1",
      dispatchContext: { workroomId: "WC-TEST", repositoryFullName: "org/repo", branchName: "fix/test", headSha: "a".repeat(40) },
      planArtifact: { resolved: true, path: "docs/superpowers/plans/parent.md", commitSha: "a".repeat(40), providerBlobId: "b".repeat(40) },
      db: { agentToolGrant: { findMany: vi.fn().mockResolvedValue(["initiative_design_review", "file_read"].map(grantKey => ({
        grantKey, agent: { agentId: "AGT-REVIEWER", displayName: "Reviewer", status: "active", archived: false, lifecycleStage: "production" },
      }))) } },
    });
    const issued = await issue(designPhaseReviewDecision(completion)!);
    expect(issued.reviewerRoutes).toHaveLength(1);
    const request = issued.reviewerRoutes[0]!.requestCoworker;
    expect(request.initiativeReviewBinding?.gate).toBe("plan-review");
    const decisions = { implementation, plan: { ...implementation, target: "plan", verdict: "allowed", blockers: [] }, completion };
    mocks.item.mockResolvedValue({ success: true, data: { readiness: { decisions } } });
    mocks.recovery.mockImplementation(({ decision }) => issue(decision));
    expect(await authorizeCoworkerRequest(request, "human", context)).toEqual({ bounded: true });
    for (const change of [{ objective: "altered" }, { requestKey: "other" }, { targetAgent: "AGT-AUTHOR" },
      { initiativeReviewBinding: { ...request.initiativeReviewBinding, expectedCurrentBaselineId: "STALE" } }]) {
      expect((await authorizeCoworkerRequest({ ...request, ...change }, "human", context)).refusal).toBeDefined();
    }
    expect(implementation.verdict).toBe("denied");
    expect(implementation.blockers[0]?.code).toBe("DECOMPOSITION_REQUIRED");
    mocks.item.mockResolvedValue({ success: true, data: { readiness: { decisions: { ...decisions,
      completion: { ...completion, unmet: completion.unmet.slice(1) },
    } } } });
    expect((await authorizeCoworkerRequest(request, "human", context)).refusal).toBeDefined();
  });

  it("authorizes the same alternate exact plan packet as the issuer after owned exhaustion", async () => {
    const implementation: InitiativeReadinessDecision = {
      decisionId: "IRD-PLAN", policyVersion: "initiative-readiness.v3", subject: { kind: "backlog-item", id: "BI-TEST" },
      transitionObject: { kind: "work-capsule", id: "WC-TEST", expectedVersion: "claim.v1", targetState: "implementation" },
      profile: "fix", target: "implementation", verdict: "input-required", satisfied: [], blockers: [],
      unmet: [readinessRequirement({ code: "PLAN_REVIEW_REQUIRED", state: "missing", accountableRole: "plan-reviewer" })],
      evaluatedAt: "2026-10-12T20:00:00Z",
    };
    const input = { decision: implementation, currentAgentId: "AGT-AUTHOR", expectedCurrentBaselineId: "BASE-1",
      dispatchContext: { workroomId: "WC-TEST", repositoryFullName: "org/repo", branchName: "fix/test", headSha: "a".repeat(40) },
      planArtifact: { resolved: true as const, path: "docs/superpowers/plans/recovery.md", commitSha: "b".repeat(40), providerBlobId: "c".repeat(40) },
      db: { agentToolGrant: { findMany: vi.fn().mockResolvedValue(["AGT-FIRST", "AGT-NEXT"].flatMap(agentId => ["initiative_design_review", "file_read"].map(grantKey => ({
        grantKey, agent: { agentId, displayName: agentId, status: "active", archived: false, lifecycleStage: "production" },
      })))) } },
    };
    const old = (await resolveInitiativeReviewerRecovery(input)).reviewerRoutes[0]!.requestCoworker;
    const scope = ["initiative_evidence_write", "backlog-item:BI-TEST", ...old.requiredToolNames!.map(name => `tool:${name}`)];
    const authority = { userId: "human", taskAuthorityKey: "oauth-family:consent-family" };
    const taskRunId = deterministicExternalTaskRunId(authority.taskAuthorityKey, old.requestKey);
    mocks.task.mockImplementation(async ({ where }) => where.taskRunId === taskRunId ? {
      taskRunId, userId: "human", currentAgentId: "AGT-FIRST", status: "input-required", authorityScope: scope,
      a2aMetadata: { taskAuthorityKey: authority.taskAuthorityKey, idempotencyKey: old.requestKey, requestedAgentId: "AGT-FIRST",
        requestDigestVersion: 2, requestDigest: remoteTaskRequestDigest({ agentId: old.targetAgent, routeContext: "/build",
          title: old.questionPacketSummary, objective: old.objective, prompt: old.objective, idempotencyKey: old.requestKey,
          riskClass: "bounded-write", authorityScope: scope, collaborationKind: "handoff", initiativeReviewBinding: old.initiativeReviewBinding }) },
      progressPayload: { terminalWriterWait: { schemaVersion: 1, kind: "missing-terminal-writer", writerToolName: "record_initiative_design_review",
        resumeMode: "same-taskrun", dispatchContract: "required-tool-call", attempt: 3, observedAt: "2026-10-12T20:00:00Z" } },
    } : null);
    const issue = (taskAuthority: typeof authority) => resolveInitiativeReviewerRecovery({ ...input,
      isPlanReviewExhausted: createExhaustedPlanReviewPredicate(taskAuthority, { taskRun: { findFirst: mocks.task } }) });
    const alternate = (await issue(authority)).reviewerRoutes[0]!.requestCoworker;
    expect(alternate.targetAgent).toBe("AGT-NEXT");
    mocks.item.mockResolvedValue({ success: true, data: { readiness: { decisions: { implementation } } } });
    mocks.recovery.mockImplementation(({ taskAuthority }) => issue(taskAuthority));
    expect(await authorizeCoworkerRequest(alternate, "human", context)).toEqual({ bounded: true });
    expect((await authorizeCoworkerRequest(old, "human", context)).refusal).toBeDefined();
    expect((await authorizeCoworkerRequest({ ...alternate, requestKey: old.requestKey }, "human", context)).refusal).toBeDefined();
  });

  it("accepts the real claim issuer's baseline-before-coverage packet without widening authority", async () => {
    const implementation: InitiativeReadinessDecision = {
      decisionId: "IRD-BASELINE-PREREQUISITE", policyVersion: "initiative-readiness.v3",
      subject: { kind: "backlog-item", id: "BI-TEST" },
      transitionObject: { kind: "work-capsule", id: "WC-TEST", expectedVersion: "claim.v1", targetState: "implementation" },
      profile: "fix", target: "implementation", verdict: "input-required", satisfied: [], blockers: [],
      unmet: [readinessRequirement({ code: "PLAN_REQUIRED", state: "missing", accountableRole: "implementation-planner" })],
      evaluatedAt: "2026-10-03T02:07:21.794Z",
    };
    const completion: InitiativeReadinessDecision = { ...implementation, target: "completion", unmet: [
      ...implementation.unmet,
      readinessRequirement({ code: "OBJECTIVE_BASELINE_REQUIRED", state: "missing", accountableRole: "design-checklist-reviewer" }),
      readinessRequirement({ code: "ACCEPTANCE_EVIDENCE_REQUIRED", state: "missing", accountableRole: "acceptance-reviewer" }),
    ] };
    const issue = (decision: InitiativeReadinessDecision) => resolveInitiativeReviewerRecovery({
      decision, currentAgentId: "AGT-AUTHOR", expectedCurrentBaselineId: null,
      dispatchContext: { workroomId: "WC-TEST", repositoryFullName: "org/repo", branchName: "fix/test", headSha: "a".repeat(40) },
      canonicalArtifact: { resolved: true, path: "docs/superpowers/specs/recovery.md", providerBlobId: "b".repeat(40) },
      db: { agentToolGrant: { findMany: vi.fn().mockResolvedValue(["initiative_design_review", "file_read"].map((grantKey) => ({
        grantKey, agent: { agentId: "AGT-REVIEWER", displayName: "Independent Reviewer", status: "active", archived: false, lifecycleStage: "production" },
      }))) } },
    });
    const issued = await issue(implementation);
    expect(issued.reviewerRoutes).toHaveLength(1);
    const request = issued.reviewerRoutes[0]!.requestCoworker;
    expect(request.initiativeReviewBinding?.gate).toBe("spec-approval");
    mocks.item.mockResolvedValue({ success: true, data: { readiness: { decisions: { implementation, completion } } } });
    mocks.recovery.mockImplementation(({ decision }) => issue(decision));
    expect(await authorizeCoworkerRequest(request, "human", context)).toEqual({ bounded: true });
    expect((await authorizeCoworkerRequest({ ...request, objective: "altered" }, "human", context)).refusal).toBeDefined();
    expect((await authorizeCoworkerRequest({ ...request, targetAgent: "AGT-AUTHOR" }, "human", context)).refusal).toBeDefined();
    mocks.item.mockResolvedValue({ success: true, data: { readiness: { decisions: {
      implementation: { ...implementation, unmet: [] }, completion,
    } } } });
    expect((await authorizeCoworkerRequest(request, "human", context)).refusal).toBeDefined();
  });
  it("authorizes the issuer's exact stale-scope amendment with valid old-baseline plan coverage", async () => {
    const scope = { ...approvedScope, subject: { kind: "backlog-item", id: "BI-TEST" }, profile: "fix",
      artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "org/repo", commitSha: "c".repeat(40),
        providerBlobId: "d".repeat(40), path: "docs/superpowers/specs/recovery.md" } };
    const activities = readyActivities().map(activity => ({ ...activity, payload: activity.kind === "initiative_scope_baseline"
      ? scope : { ...activity.payload, subject: { kind: "backlog-item", id: "BI-TEST" },
        ...(["research", "dependency-disposition"].includes(activity.gateKey ?? "") ? { artifactDigest: "sha256:amended" } : {}) } }));
    const project = (target: "plan" | "implementation" | "completion") => projectBacklogItemReadiness({
      item: { ...readinessItem, itemId: "BI-TEST", type: "product", workType: "bug", workShape: "delivery-large@1.0.0" },
      activities, target,
      transitionObject: { kind: "work-capsule", id: "WC-TEST", expectedVersion: "claim.v1", targetState: target },
      authorization: "pass", capsuleIdentity: "pass", currentDesign: { state: "verified", digest: "sha256:amended" },
      evaluatedAt: "2026-10-22T07:08:00.000Z",
    }).decision;
    const decisions = { plan: project("plan"), implementation: project("implementation"), completion: project("completion") };
    expect(decisions.implementation.unmet).toEqual([]);
    expect(decisions.implementation).toMatchObject({ verdict: "allowed",
      satisfied: expect.arrayContaining([expect.objectContaining({ code: "PLAN_REQUIRED", state: "pass" })]) });
    expect(decisions.completion.unmet).toContainEqual(expect.objectContaining({ code: "OBJECTIVE_BASELINE_REQUIRED",
      state: "stale", accountableRole: "design-checklist-reviewer" }));
    const issue = (decision: InitiativeReadinessDecision) => resolveInitiativeReviewerRecovery({
      decision, currentAgentId: "AGT-AUTHOR", expectedCurrentBaselineId: approvedScope.baselineId,
      dispatchContext: { workroomId: "WC-TEST", repositoryFullName: "org/repo", branchName: "fix/test", headSha: "a".repeat(40) },
      canonicalArtifact: { resolved: true, path: scope.artifactRef.path, providerBlobId: "b".repeat(40) },
      db: { agentToolGrant: { findMany: vi.fn().mockResolvedValue(["initiative_design_review", "file_read"].map(grantKey => ({
        grantKey, agent: { agentId: "AGT-REVIEWER", displayName: "Independent Reviewer", status: "active", archived: false, lifecycleStage: "production" },
      }))) } },
    });
    const issued = await issue(designPhaseReviewDecision(decisions.completion)!);
    expect(issued.reviewerRoutes).toHaveLength(1);
    const request = issued.reviewerRoutes[0]!.requestCoworker;
    expect(request.initiativeReviewBinding).toMatchObject({ gate: "spec-approval", writerToolName: "record_initiative_design_review",
      expectedCurrentBaselineId: approvedScope.baselineId,
      artifactRef: { commitSha: "a".repeat(40), providerBlobId: "b".repeat(40) } });
    mocks.item.mockResolvedValue({ success: true, data: { readiness: { decisions } } });
    mocks.recovery.mockImplementation(({ decision }) => issue(decision));
    expect(await authorizeCoworkerRequest(request, "human", context)).toEqual({ bounded: true });
    expect(mocks.recovery).toHaveBeenCalledWith(expect.objectContaining({ decision: expect.objectContaining({
      target: "completion", unmet: [expect.objectContaining({ code: "OBJECTIVE_BASELINE_REQUIRED", state: "stale" })],
    }) }));
    for (const change of [{ objective: "altered" }, { requestKey: "other" }, { targetAgent: "AGT-AUTHOR" },
      { initiativeReviewBinding: { ...request.initiativeReviewBinding, expectedCurrentBaselineId: "other-baseline" } },
      { initiativeReviewBinding: { ...request.initiativeReviewBinding, writerToolName: "record_initiative_architecture_review" } },
      { initiativeReviewBinding: { ...request.initiativeReviewBinding,
        artifactRef: { ...request.initiativeReviewBinding!.artifactRef, providerBlobId: "e".repeat(40) } } }]) {
      expect((await authorizeCoworkerRequest({ ...request, ...change }, "human", context)).refusal).toBeDefined();
    }
    mocks.access.mockResolvedValue({ decision: { level: "none" } });
    expect((await authorizeCoworkerRequest(request, "human", context)).refusal).toBeDefined();
    expect(decisions.implementation.verdict).toBe("allowed");
    mocks.access.mockResolvedValue({ decision: { level: "action" } });
    // A child's changed source cannot amend its parent's retained scope, and
    // body criteria do not become an independently approved repository design.
    for (const scenario of ["inherited", "body"] as const) {
      const parentActivities = readyActivities().map(activity => activity.kind === "initiative_scope_baseline"
        ? { ...activity, payload: { ...approvedScope, profile: "fix", artifactRef: scope.artifactRef } } : activity);
      const bodyActivities = activities.map(activity => activity.kind === "initiative_scope_baseline"
        ? { ...activity, payload: { ...scope, origin: "item-body", artifactRef: {
          kind: "document-version", repositoryFullName: "org/repo", versionId: "body-version", valueDigest: scope.artifactDigest,
        } } } : activity);
      const projectUnowed = (target: "implementation" | "completion") => projectBacklogItemReadiness({
        item: { ...readinessItem, itemId: "BI-TEST", type: "product", workType: "bug", workShape: "delivery-large@1.0.0" },
        activities: scenario === "body" ? bodyActivities : [], target,
        ...(scenario === "inherited" ? { inheritedScope: { parentItemId: readinessItem.itemId,
          coverageActivityId: "parent-coverage", activities: parentActivities } } : {}),
        transitionObject: { kind: "work-capsule", id: "WC-TEST", expectedVersion: "claim.v1", targetState: target },
        authorization: "pass", capsuleIdentity: "pass", currentDesign: { state: "verified", digest: "sha256:amended" },
        evaluatedAt: "2026-10-22T07:08:00.000Z",
      });
      const terminal = projectUnowed("completion");
      expect(terminal.baselineId).toBe(approvedScope.baselineId);
      expect(terminal.inheritedFrom).toBe(scenario === "inherited" ? readinessItem.itemId : null);
      expect(terminal.decision.satisfied).toContainEqual(expect.objectContaining({ code: "OBJECTIVE_BASELINE_REQUIRED", state: "pass" }));
      mocks.item.mockResolvedValue({ success: true, data: { readiness: { decisions: {
        implementation: projectUnowed("implementation").decision, completion: terminal.decision,
      } } } });
      expect((await authorizeCoworkerRequest(request, "human", context)).refusal?.message).toContain("no pending review");
    }
  });
  it("accepts the same immutable request delivered through the bounded reader and still rejects alteration", async () => {
    const projection = boundedBacklogRecoveryRead({ itemId: "BI-TEST", status: "open", workShape: "delivery-large@1.0.0",
      gate: binding.gate, recovery: { reviewerRoutes: [{ gate: binding.gate, workroomId: "WC-TEST", requestCoworker: packet }], escalations: [], unroutable: [] } });
    const delivered = (projection.data?.recovery as { reviewerRoutes: { requestCoworker: typeof packet }[] }).reviewerRoutes[0]!.requestCoworker;
    expect(delivered).toBe(packet);
    expect(await authorizeCoworkerRequest(delivered, "human", context)).toEqual({ bounded: true });
    const refused = await authorizeCoworkerRequest({ ...delivered, objective: "altered" }, "human", context);
    expect(refused.refusal).toMatchObject({ success: false, error: "independent_review_request_denied" });
    expect(refused.refusal?.data?.action).toContain("recoveryGate");
  });
  it("source-only proof requires platform scope and exact issuance even with general delegation", async () => {
    const design = { ...packet, initiativeReviewBinding: { ...binding, writerToolName: "record_initiative_design_review", gate: "design-spec" },
      requiredToolNames: ["read_source_at_version", "record_initiative_design_review"] };
    const implementation = { target: "implementation", verdict: "input-required", subject: { id: "BI-TEST" }, blockers: [],
      unmet: [{ code: "CANONICAL_DESIGN_REQUIRED", accountableRole: "design-checklist-reviewer" }] };
    mocks.item.mockResolvedValue({ success: true, data: { scopeKind: "platform", readiness: { decisions: { implementation } } } });
    mocks.recovery.mockResolvedValue({ reviewerRoutes: [{ independent: true, requestCoworker: design }] });
    mocks.agent.mockResolvedValue({ status: "active", archived: false, toolGrants: [{ grantKey: "thread_write" }, { grantKey: "initiative_evidence_write" }] });
    const ctx = { ...context, tokenGrantScopes: ["thread_write", "initiative_evidence_write"] };
    expect(await authorizeCoworkerRequest(design, "human", ctx, { sourceOnly: true })).toEqual({ bounded: true });
    expect((await authorizeCoworkerRequest({ ...design, objective: "customer evidence" }, "human", ctx, { sourceOnly: true })).refusal).toBeDefined();
    mocks.item.mockResolvedValue({ success: true, data: { scopeKind: "organization", readiness: { decisions: { implementation } } } });
    expect((await authorizeCoworkerRequest(design, "human", ctx, { sourceOnly: true })).refusal).toBeDefined();
    expect((await authorizeCoworkerRequest(packet, "human", ctx, { sourceOnly: true })).refusal).toBeDefined();
  });
  it("returns the design size notice with a new design-spec request, without refusing it (BI-4592CF69)", async () => {
    const design = { ...packet, initiativeReviewBinding: { ...binding, writerToolName: "record_initiative_design_review", gate: "design-spec" },
      requiredToolNames: ["read_source_at_version", "record_initiative_design_review"] };
    const implementation = { target: "implementation", verdict: "input-required", subject: { id: "BI-TEST" }, blockers: [],
      unmet: [{ code: "CANONICAL_DESIGN_REQUIRED", accountableRole: "design-checklist-reviewer" }] };
    mocks.item.mockResolvedValue({ success: true, data: { readiness: { decisions: { implementation } } } });
    mocks.recovery.mockResolvedValue({ reviewerRoutes: [{ independent: true, requestCoworker: design }] });
    mocks.preflight.mockResolvedValue({ refusal: null, notice: "This design is 70,000 characters." });
    expect(await authorizeCoworkerRequest(design, "human", context)).toEqual({ bounded: true, notice: "This design is 70,000 characters." });
    expect(mocks.preflight).toHaveBeenCalledWith(design.initiativeReviewBinding);
  });
  it("requires the exact original locator and does not admit an arbitrary recovery through general thread delegation", async () => {
    const target = { taskRunId: "TR-MCP-original", requestDigest: "a".repeat(64), expectedUpdatedAt: "2026-10-13T18:00:00.053Z" };
    recoveryTarget.mockResolvedValue({ kind: "target", target });
    expect((await authorizeCoworkerRequest(packet, "human", context)).refusal).toBeDefined();
    expect(await authorizeCoworkerRequest({ ...packet, reviewRecovery: target }, "human", context)).toEqual({ bounded: true });
    expect((await authorizeCoworkerRequest({ ...packet, reviewRecovery: { ...target, requestDigest: "b".repeat(64) } }, "human", context)).refusal).toBeDefined();
    mocks.agent.mockResolvedValue({ status: "active", archived: false, toolGrants: [{ grantKey: "thread_write" }] });
    expect((await authorizeCoworkerRequest({ ...packet, reviewRecovery: target }, "human", {
      ...context, tokenGrantScopes: ["thread_write"],
    })).refusal).toBeDefined();
  });
  it("admits a merged repair's retired room for the issuer's exact PIR packet only (BI-CE661173)", async () => {
    const retired = { ...await mocks.room(), status: "archived" };
    mocks.room.mockImplementation(async ({ where }) => where.archivedAt === null ? null : retired);
    expect(await authorizeCoworkerRequest(packet, "human", context)).toEqual({ bounded: true });
    expect(mocks.room).toHaveBeenLastCalledWith(expect.objectContaining({ where: {
      capsuleId: "WC-TEST", status: { notIn: ["abandoned", "superseded"] } } }));
    expect(mocks.recovery).toHaveBeenCalledWith(expect.objectContaining({ refusedWorkroomId: "WC-TEST" }));
    // The retired room grants nothing by itself: the issuer must re-issue the exact packet.
    mocks.recovery.mockResolvedValue({ reviewerRoutes: [] });
    expect((await authorizeCoworkerRequest(packet, "human", context)).refusal?.success).toBe(false);
    // And it is read only for the PIR writer: another lane on a retired room is refused before readiness.
    mocks.item.mockClear();
    const design = { ...packet, initiativeReviewBinding: { ...binding, writerToolName: "record_initiative_design_review", gate: "design-spec" },
      requiredToolNames: ["read_source_at_version", "record_initiative_design_review"] };
    expect((await authorizeCoworkerRequest(design, "human", context)).refusal?.success).toBe(false);
    expect(mocks.item).not.toHaveBeenCalled();
  });
  it("admits a person-opened retired PIR anchor on that person's admission, carried by an assistant the room never admitted (BI-D3BAF945)", async () => {
    const retired = { ...await mocks.room(), status: "archived" };
    mocks.room.mockImplementation(async ({ where }) => where.archivedAt === null ? null : retired);
    // The person opened the room alone; their carrying assistant is not in it.
    mocks.access.mockResolvedValue({ decision: { level: "none", reason: "not-admitted" } });
    humanAccess.mockResolvedValue({ decision: { level: "action" } });
    expect(await authorizeCoworkerRequest(packet, "human", context)).toEqual({ bounded: true });
    expect(humanAccess).toHaveBeenCalledWith({ userId: "human", workroomId: "room-row", requested: "action" });
    // A person not admitted to the room cannot have it carried.
    humanAccess.mockResolvedValue({ decision: { level: "none", reason: "not-admitted" } });
    expect((await authorizeCoworkerRequest(packet, "human", context)).refusal?.success).toBe(false);
    // A live room still needs its carrying assistant admitted.
    mocks.room.mockResolvedValue({ ...retired, status: "ready" });
    humanAccess.mockResolvedValue({ decision: { level: "action" } });
    expect((await authorizeCoworkerRequest(packet, "human", context)).refusal?.success).toBe(false);
  });
  // Live install 2026-10-28: merged break-fix rooms are retired by status
  // ("archived") while archivedAt stays null, so the live-room read found them
  // and the retired-anchor rules never applied. Six carried PIRs were refused
  // "You and this coworker must both be admitted", and a headless one "immutable
  // source changed".
  it("treats a room retired by status, with no archivedAt, as the retired PIR anchor", async () => {
    const statusRetired = { ...await mocks.room(), status: "archived" };
    mocks.room.mockResolvedValue(statusRetired);
    mocks.access.mockResolvedValue({ decision: { level: "none", reason: "not-admitted" } });
    humanAccess.mockResolvedValue({ decision: { level: "action" } });
    expect(await authorizeCoworkerRequest(packet, "human", context)).toEqual({ bounded: true });
    expect(humanAccess).toHaveBeenCalledWith({ userId: "human", workroomId: "room-row", requested: "action" });
    // Headless: the anchor never recorded its head; the issuer's re-issue proves the merged head.
    mocks.room.mockResolvedValue({ ...statusRetired, headSha: null });
    expect(await authorizeCoworkerRequest(packet, "human", context)).toEqual({ bounded: true });
    // Only for the PIR writer: a design lane on the same room still needs its assistant.
    const design = { ...packet, initiativeReviewBinding: { ...binding, writerToolName: "record_initiative_design_review", gate: "design-spec" },
      requiredToolNames: ["read_source_at_version", "record_initiative_design_review"] };
    mocks.room.mockResolvedValue(statusRetired);
    expect((await authorizeCoworkerRequest(design, "human", context)).refusal?.message).toContain("must both be admitted");
  });
  it("accepts only a regenerated packet after current human, consent, grants and exact room checks", async () => {
    expect(await authorizeCoworkerRequest(packet, "human", context)).toEqual({ bounded: true });
    expect(mocks.access).toHaveBeenCalledWith({ userId: "human", agentId: "AGT-AUTHOR", workroomId: "room-row", requested: "action" });
    expect(mocks.recovery).toHaveBeenCalledWith(expect.objectContaining({ currentAgentId: "AGT-AUTHOR", refusedWorkroomId: "WC-TEST" }));
  });
  it.each([
    ["arbitrary work", { objective: "deploy production" }],
    ["another reviewer", { targetAgent: "AGT-OTHER" }],
    ["self review", { targetAgent: "AGT-AUTHOR" }],
    ["changed key", { requestKey: "different" }],
    ["extra tool", { requiredToolNames: [...packet.requiredToolNames, "deploy"] }],
    ["portal override", { threadId: "another-thread" }],
    ["extra dispatch depth", { tier: 3 }],
    ["changed blob", { initiativeReviewBinding: { ...binding, artifactRef: { ...binding.artifactRef, providerBlobId: "c".repeat(40) } } }],
    ["sibling room", { initiativeReviewBinding: { ...binding, workroomRef: { ...binding.workroomRef, workroomId: "WC-SIBLING" } } }],
  ])("rejects %s", async (_label, change) => {
    expect((await authorizeCoworkerRequest({ ...packet, ...change }, "human", context)).refusal?.success).toBe(false);
  });
  it.each(["pat", "client_credentials", "read-only", "revoked-consent", "other-user", "other-agent", "missing-binding", "revoked-grant", "revoked-human", "unadmitted-room", "closed-gate"])("rejects %s", async (condition) => {
    const ctx = { ...context };
    if (condition === "pat") ctx.authSource = "pat";
    if (condition === "client_credentials") mocks.token.mockResolvedValue({ userId: "human", agentId: "AGT-AUTHOR", authorityBindingId: "consent", oauthClient: { registrationKind: "credentials" } });
    if (condition === "read-only") ctx.tokenScope = "read";
    if (condition === "revoked-consent") mocks.currentConsent.mockResolvedValue(false);
    if (condition === "other-user") mocks.token.mockResolvedValue({ userId: "different" });
    if (condition === "other-agent") mocks.token.mockResolvedValue({ userId: "human", agentId: "other" });
    if (condition === "missing-binding") mocks.token.mockResolvedValue({ userId: "human", agentId: "AGT-AUTHOR" });
    if (condition === "revoked-grant") mocks.agent.mockResolvedValue({ status: "active", archived: false, toolGrants: [] });
    if (condition === "revoked-human") mocks.human.mockResolvedValue({ isSuperuser: false, platformRole: null });
    if (condition === "unadmitted-room") mocks.access.mockResolvedValue({ decision: { level: "none" } });
    if (condition === "closed-gate") mocks.item.mockResolvedValue({ success: true, data: { readiness: { decisions: { completion: { verdict: "allowed" } } } } });
    expect((await authorizeCoworkerRequest(packet, "human", ctx)).refusal?.success).toBe(false);
  });
  // Pin exact equality for the implementation decision, independently of the
  // later completion obligations (BI-817556D8, BI-CF118B6D).
  it("accepts an exact design-phase packet issued by the implementation or plan decision", async () => {
    const planBinding = { ...binding, writerToolName: "record_initiative_design_review", gate: "plan-review" };
    const planPacket = { ...packet, requestKey: "plan-review:immutable", initiativeReviewBinding: planBinding,
      requiredToolNames: ["record_initiative_design_review", "read_source_at_version"] };
    const pending = { target: "implementation", verdict: "input-required", subject: { id: "BI-TEST" },
      unmet: [{ code: "PLAN_REVIEW_REQUIRED", accountableRole: "plan-reviewer" }], blockers: [] };
    mocks.item.mockResolvedValue({ success: true, data: { readiness: { decisions: {
      plan: { verdict: "allowed" }, implementation: pending, completion: pending } } } });
    mocks.recovery.mockImplementation(async ({ decision }) => ({ reviewerRoutes: decision.target === "implementation"
      ? [{ independent: true, requestCoworker: planPacket }] : [] }));
    expect(await authorizeCoworkerRequest(planPacket, "human", context)).toEqual({ bounded: true });
    expect((await authorizeCoworkerRequest({ ...planPacket, objective: "altered" }, "human", context)).refusal?.success).toBe(false);
    mocks.recovery.mockResolvedValue({ reviewerRoutes: [] });
    expect((await authorizeCoworkerRequest(planPacket, "human", context)).refusal?.success).toBe(false);
  });
  it("tells a caller without an acting coworker which connection it needs", async () => {
    const refusal = (await authorizeCoworkerRequest(packet, "human", { ...context, agentId: undefined, authSource: "pat" })).refusal;
    expect(refusal?.message).toMatch(/OAuth/);
    expect(refusal?.message).toMatch(/coworker/);
  });
  it.each([
    ["design-spec", "record_initiative_design_review", "CANONICAL_DESIGN_REQUIRED"],
    ["spec-approval", "record_initiative_design_review", "SPEC_APPROVAL_REQUIRED"],
    ["architecture-review", "record_initiative_architecture_review", "REVIEW_REQUIRED"],
    ["plan-review", "record_initiative_design_review", "PLAN_REVIEW_REQUIRED"],
  ])("routes %s without unrelated completion/research prerequisites swallowing its packet", async (gate, writerToolName, code) => {
    const reviewPacket = { ...packet, initiativeReviewBinding: { ...binding, gate, writerToolName },
      requiredToolNames: [writerToolName, "read_source_at_version"] };
    const implementation = { target: "implementation", verdict: "input-required", subject: { id: "BI-TEST" },
      blockers: [], unmet: [{ code, accountableRole: "design-checklist-reviewer" },
        { code: "RESEARCH_REQUIRED", accountableRole: "design-author" }] };
    const completion = { ...implementation, target: "completion", unmet: [...implementation.unmet,
      { code: "ACCEPTANCE_EVIDENCE_REQUIRED", accountableRole: "acceptance-reviewer" }] };
    mocks.item.mockResolvedValue({ success: true, data: { readiness: { decisions: { implementation, completion } } } });
    // Model the real recovery precedence: unresolved research blocks terminal
    // recovery before it ever reaches the independent design-review lanes.
    mocks.recovery.mockImplementation(async ({ decision }) => ({ reviewerRoutes:
      decision.unmet.some((entry: { code: string }) => entry.code === "RESEARCH_REQUIRED")
        ? [] : [{ independent: true, requestCoworker: reviewPacket }] }));
    expect(await authorizeCoworkerRequest(reviewPacket, "human", context)).toEqual({ bounded: true });
    expect(mocks.recovery).toHaveBeenCalledWith(expect.objectContaining({
      decision: expect.objectContaining({ target: "implementation", unmet: [{ code, accountableRole: "design-checklist-reviewer" }] }),
    }));
    expect((await authorizeCoworkerRequest({ ...reviewPacket, objective: "forged" }, "human", context)).refusal?.success).toBe(false);
  });
  it("does not permit author-owned evidence through the independent-review lane", async () => {
    expect((await authorizeCoworkerRequest({ ...packet, initiativeReviewBinding: { ...binding,
      writerToolName: "record_initiative_evidence", gate: "research" } }, "human", context)).refusal?.success).toBe(false);
  });
  it("preserves the general lane only when both token and current coworker have thread_write", async () => {
    mocks.agent.mockResolvedValue({ status: "active", archived: false, toolGrants: [{ grantKey: "thread_write" }] });
    expect(await authorizeCoworkerRequest({ objective: "general" }, "human", { ...context, tokenGrantScopes: ["thread_write"] })).toEqual({ bounded: false });
    expect((await authorizeCoworkerRequest({ objective: "general" }, "human", context)).refusal?.success).toBe(false);
  });
  it("retains the same packet across credential refresh and concurrent room requests", async () => {
    expect(await authorizeCoworkerRequest(packet, "human", { ...context, apiTokenId: "access-2", threadId: "portal-context" })).toEqual({ bounded: true });
    const other = { ...packet, requestKey: "other-room", initiativeReviewBinding: { ...binding, workroomRef: { ...binding.workroomRef, workroomId: "WC-SECOND" } } };
    mocks.recovery.mockResolvedValueOnce({ reviewerRoutes: [{ independent: true, requestCoworker: other }] });
    expect(await authorizeCoworkerRequest(other, "human", context)).toEqual({ bounded: true });
    expect(mocks.recovery).toHaveBeenLastCalledWith(expect.objectContaining({ refusedWorkroomId: "WC-SECOND" }));
  });
  it("replays a finished review after refresh only with the same persisted request and a real writer receipt", async () => {
    // Historical receipt readback needs current room access, not a new execution
    // against the room's later source. No receipt still refuses below.
    mocks.room.mockResolvedValue({ ...await mocks.room(), headSha: "f".repeat(40) });
    mocks.item.mockResolvedValue({ success: true, data: { readiness: { decisions: { completion: { verdict: "allowed" } } } } });
    mocks.task.mockResolvedValue({ a2aMetadata: { requestDigestVersion: 2, requestDigest: remoteTaskRequestDigest({
      agentId: packet.targetAgent, routeContext: "/build", title: packet.questionPacketSummary,
      objective: packet.objective, prompt: packet.objective, idempotencyKey: packet.requestKey,
      riskClass: "bounded-write", collaborationKind: "handoff", initiativeReviewBinding: binding,
      authorityScope: ["initiative_evidence_write", "backlog-item:BI-TEST", ...packet.requiredToolNames.map((name) => `tool:${name}`)],
    }) } });
    mocks.outcome.mockResolvedValue({ kind: "receipt", summary: "Independent review recorded" });
    expect(await authorizeCoworkerRequest(packet, "human", { ...context, apiTokenId: "refreshed" })).toEqual({ bounded: true });
    mocks.outcome.mockResolvedValue(null);
    expect((await authorizeCoworkerRequest(packet, "human", context)).refusal?.success).toBe(false);
    mocks.outcome.mockResolvedValue({ kind: "receipt" });
    expect((await authorizeCoworkerRequest({ ...packet, objective: "altered" }, "human", context)).refusal?.success).toBe(false);
  });
});

describe("Build Studio rooms (BI-926A7E90)", () => {
  const revisionBinding: InitiativeReviewBinding = { writerToolName: "record_initiative_design_review", itemId: "BI-TEST", gate: "spec-approval",
    expectedCurrentBaselineId: null,
    workroomRef: { kind: "workroom-head", workroomId: "WC-BS", repositoryFullName: "org/repo", branchName: "build/FB-1", headSha: "sha256:design" },
    artifactRef: { kind: "feature-build-revision", repositoryFullName: "org/repo", revisionId: "rev_1", valueDigest: "sha256:design" } };
  const revisionPacket = { targetAgent: "AGT-REVIEWER", objective: "Review the design revision", questionPacketSummary: "spec-approval for BI-TEST",
    requestKey: "initiative-readiness:BI-TEST:spec-approval:sha256:design", tier: 2, enteredVia: "handoff",
    requiredToolNames: ["record_initiative_design_review", "read_build_artifact_revision"], initiativeReviewBinding: revisionBinding };
  const implementation = { target: "implementation", verdict: "input-required", subject: { id: "BI-TEST" }, blockers: [],
    unmet: [{ code: "SPEC_APPROVAL_REQUIRED", accountableRole: "design-checklist-reviewer" }] };

  beforeEach(() => {
    mocks.room.mockResolvedValue({ id: "room-bs", backlogItemId: "cuid-item", executorKind: "build-studio", requestedByPrincipalId: null, featureBuild: { createdById: "human" } });
    mocks.item.mockResolvedValue({ success: true, data: { readiness: { decisions: { implementation } } } });
    mocks.buildStudioRoutes.mockResolvedValue({ routed: true, routes: [{ workroomId: "WC-BS", requestCoworker: revisionPacket }] });
  });

  it("accepts the dispatcher's own packet on a connection of the person who requested the build, keyed by the item's row id", async () => {
    expect(await authorizeCoworkerRequest(revisionPacket, "human", context)).toEqual({ bounded: true });
    expect(mocks.buildStudioRoutes).toHaveBeenCalledWith({ itemId: "BI-TEST", capsuleId: "WC-BS", authorAgentId: "AGT-WS-BUILD" });
    expect(mocks.access).not.toHaveBeenCalled();
    expect(mocks.recovery).not.toHaveBeenCalled();
  });

  it("refuses a connection that is not the requesting person's, and a packet the resolver did not issue", async () => {
    mocks.room.mockResolvedValue({ id: "room-bs", backlogItemId: "cuid-item", executorKind: "build-studio", requestedByPrincipalId: "prn-human", featureBuild: { createdById: "someone-else" } });
    mocks.alias.mockResolvedValue({ principalId: "prn-other" });
    expect((await authorizeCoworkerRequest(revisionPacket, "human", context)).refusal?.message).toContain("person who requested this Build Studio build");
    mocks.alias.mockResolvedValue({ principalId: "prn-human" });
    mocks.buildStudioRoutes.mockResolvedValue({ routed: true, routes: [{ workroomId: "WC-BS", requestCoworker: { ...revisionPacket, objective: "another review" } }] });
    expect((await authorizeCoworkerRequest(revisionPacket, "human", context)).refusal?.message).toContain("changed or is no longer eligible");
  });

  // BI-27519C1A: the build's plan raised its shape, so its own plan gate owes a
  // plan review the item's projection does not see. Admission asked the
  // projection and refused every dispatch as "no pending review"; it now asks
  // the same Build Studio issuer the dispatcher sent the packet from.
  it("admits the issuer's packet when the item projection sees no pending design-phase review", async () => {
    mocks.item.mockResolvedValue({ success: true, data: { readiness: { decisions: { implementation: { ...implementation, verdict: "allowed", unmet: [] } } } } });
    expect(await authorizeCoworkerRequest(revisionPacket, "human", context)).toEqual({ bounded: true });
    mocks.item.mockResolvedValue({ success: true, data: { readiness: { decisions: {} } } });
    expect(await authorizeCoworkerRequest(revisionPacket, "human", context)).toEqual({ bounded: true });
  });

  it("still refuses when the Build Studio issuer owes nothing", async () => {
    mocks.buildStudioRoutes.mockResolvedValue({ routed: true, routes: [] });
    expect((await authorizeCoworkerRequest(revisionPacket, "human", context)).refusal?.message).toContain("no pending review");
  });
});
