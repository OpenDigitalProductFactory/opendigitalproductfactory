import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  count: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  findEpic: vi.fn(),
  countEpics: vi.fn(),
  findEpics: vi.fn(),
  buildReferenceIndex: vi.fn(),
  searchSpecsAndPlans: vi.fn(),
  specPlanCorpusCaveat: vi.fn(),
  loadBacklogWorkroomOwnership: vi.fn(),
  mapDemandRows: vi.fn(),
  projectReadiness: vi.fn(),
  resolveTerminalRecovery: vi.fn(),
  readCompletion: vi.fn(),
  prepareCurrentDesign: vi.fn(),
  roomAccess: vi.fn(),
  roomIdentity: vi.fn(),
  taskAuthority: vi.fn(),
}));

const CORPUS_AVAILABLE = { available: true, root: "/repo", searchedPaths: ["docs/superpowers/specs", "docs/superpowers/plans"], missingPaths: [], fileCount: 2, reason: "Searched 2 markdown file(s)." };

vi.mock("@dpf/db", () => ({
  prisma: {
    backlogItem: { count: mocks.count, findMany: mocks.findMany, findUnique: mocks.findUnique, findFirst: vi.fn().mockResolvedValue(null) },
    backlogItemActivity: { findMany: vi.fn().mockResolvedValue([]) },
    epic: { findFirst: mocks.findEpic, count: mocks.countEpics, findMany: mocks.findEpics },
    workroom: { findUnique: mocks.roomIdentity },
  },
}));

vi.mock("@/lib/backlog/spec-plan-search", () => ({
  buildSpecPlanReferenceIndex: mocks.buildReferenceIndex,
  searchSpecsAndPlans: mocks.searchSpecsAndPlans,
  specPlanCorpusCaveat: mocks.specPlanCorpusCaveat,
}));

vi.mock("@/lib/work-capsules/backlog-workroom-ownership", () => ({
  loadBacklogWorkroomOwnership: mocks.loadBacklogWorkroomOwnership,
}));

vi.mock("@/lib/demand/demand-data", () => ({ mapDemandRows: mocks.mapDemandRows }));
vi.mock("@/lib/backlog/initiative-readiness/terminal-recovery", () => ({
  resolveTerminalInitiativeRecovery: mocks.resolveTerminalRecovery,
}));
vi.mock("@/lib/backlog/initiative-readiness/entry-adapter", () => ({
  projectBacklogItemReadinessSummary: mocks.projectReadiness,
}));
vi.mock("@/lib/backlog/initiative-readiness/backlog-completion-evaluation", () => ({
  readBacklogItemCompletion: mocks.readCompletion,
}));
vi.mock("@/lib/backlog/initiative-readiness/canonical-artifact-discovery", () => ({
  prepareCurrentDesignObservation: mocks.prepareCurrentDesign,
}));
vi.mock("@/lib/work-management/workroom-agent-access.server", () => ({
  resolveAgentWorkroomAccess: mocks.roomAccess,
  resolveHumanWorkroomAccess: mocks.roomAccess,
}));
vi.mock("@/lib/auth/oauth-task-authority", () => ({ resolveMcpTaskAuthorityKey: mocks.taskAuthority }));

import { getBacklogItem, listBacklogItems } from "./backlog-pack-read-tools";
import { resolveInitiativeReviewerRecovery } from "@/lib/tak/initiative-readiness-tool-grants";
import { createExhaustedPlanReviewPredicate } from "@/lib/backlog/initiative-readiness/exhausted-plan-review";
import { readinessRequirement } from "@/lib/backlog/initiative-readiness/readiness-guidance";
import type { InitiativeReadinessDecision } from "@/lib/backlog/initiative-readiness/types";
import { deterministicExternalTaskRunId, remoteTaskRequestDigest } from "@/lib/mcp-task-capacity-contract";

const baseItem = {
  itemId: "BI-DEFERRAL",
  title: "Parked work",
  status: "deferred",
  type: "portfolio",
  workType: "feature",
  source: "user-request",
  priority: 1,
  effortSize: "small",
  demandStage: "qualified",
  demandScore: null,
  demandScoreFramework: null,
  scopeKind: "platform",
  archetypeCategories: [],
  archetypeIds: [],
  scopeRationale: null,
  lifecycleTags: [],
  activeBuildId: null,
  activeBuild: null,
  updatedAt: new Date("2026-08-15T12:00:00Z"),
  createdAt: new Date("2026-08-15T12:00:00Z"),
  triageOutcome: "defer",
  epic: null,
};

describe("backlog deferral read projection", () => {
  beforeEach(() => {
    mocks.prepareCurrentDesign.mockResolvedValue({ evidence: { state: "not-applicable" } });
    vi.clearAllMocks();
    mocks.count.mockResolvedValue(1);
    mocks.findMany.mockResolvedValue([]);
    mocks.findUnique.mockResolvedValue(null);
    mocks.buildReferenceIndex.mockResolvedValue({ specs: new Set(), plans: new Set(), corpus: CORPUS_AVAILABLE });
    mocks.searchSpecsAndPlans.mockResolvedValue({ corpus: CORPUS_AVAILABLE, results: [] });
    mocks.specPlanCorpusCaveat.mockReturnValue(null);
    mocks.countEpics.mockResolvedValue(0);
    mocks.findEpics.mockResolvedValue([]);
    mocks.loadBacklogWorkroomOwnership.mockResolvedValue({ workrooms: [], liveWorkrooms: [] });
    mocks.mapDemandRows.mockReturnValue([{ activation: null, evidenceLinks: [] }]);
    mocks.projectReadiness.mockReturnValue({ verdict: "allowed" });
    mocks.readCompletion.mockResolvedValue(null);
    mocks.roomIdentity.mockResolvedValue({ id: "relational-room-row" });
    mocks.roomAccess.mockImplementation(async ({ workroomId }) => ({ decision: {
      level: workroomId === "relational-room-row" ? "content" : "none",
    } }));
    mocks.taskAuthority.mockResolvedValue("oauth-family:one");
  });

  it("shares one exact source observation with the detail and completion projections", async () => {
    mocks.findUnique.mockResolvedValue({ ...baseItem, id: "row-1", activities: [] });
    const evidence = { state: "verified", digest: "sha256:new" };
    mocks.prepareCurrentDesign.mockResolvedValue({ evidence });
    const result = await getBacklogItem({ itemId: baseItem.itemId }, "AGT-AUTHOR", "user-1");
    expect(result.success).toBe(true);
    expect(mocks.prepareCurrentDesign).toHaveBeenCalledTimes(1);
    expect(mocks.projectReadiness).toHaveBeenCalledWith(expect.objectContaining({ currentDesign: evidence }));
    expect(mocks.readCompletion).toHaveBeenCalledWith(expect.objectContaining({ currentDesign: evidence }));
  });

  it("does not issue a recovery packet when current immutable verification is unavailable", async () => {
    mocks.findUnique.mockResolvedValue({ ...baseItem, id: "row-1", activities: [] });
    mocks.prepareCurrentDesign.mockResolvedValue({ evidence: { state: "unavailable" } });
    mocks.projectReadiness.mockReturnValue({ currentDesignState: "unavailable", decisions: { completion: {
      verdict: "input-required", blockers: [], unmet: [{ code: "PLAN_REVIEW_REQUIRED" }],
    } } });
    const result = await getBacklogItem({ itemId: baseItem.itemId }, "AGT-AUTHOR", "user-1");
    expect(result).toMatchObject({ success: true, data: { readiness: { currentDesignState: "unavailable" } } });
    expect(mocks.resolveTerminalRecovery).not.toHaveBeenCalled();
  });

  it("does not report a plan-only epic as having a spec", async () => {
    mocks.countEpics.mockResolvedValue(1);
    mocks.findEpics.mockResolvedValue([{
      id: "epic-row",
      epicId: "EP-PLAN-ONLY",
      title: "Plan only",
      status: "open",
      priority: 1,
      updatedAt: new Date("2026-08-22T00:00:00.000Z"),
      scopeKind: "platform",
      archetypeCategories: [],
      archetypeIds: [],
      scopeRationale: null,
      lifecycleTags: [],
      items: [],
    }]);
    mocks.buildReferenceIndex.mockResolvedValue({
      specs: new Set(),
      plans: new Set(["EP-PLAN-ONLY"]),
      corpus: CORPUS_AVAILABLE,
    });

    const { listEpics } = await import("./backlog-pack-read-tools");
    const result = await listEpics({});

    expect((result.data as { epics: unknown[] }).epics[0]).toMatchObject({
      hasSpec: false,
      hasPlan: true,
    });
  });

  it("shows bound and active Workrooms on the canonical item read", async () => {
    const active = { capsuleId: "WC-LIVE", headBranch: "fix/live", isLive: true };
    mocks.findUnique.mockResolvedValue({
      ...baseItem, id: "row-bi", itemId: "BI-WORKROOM", title: "Owned work", status: "open",
      body: null, createdAt: new Date("2026-08-31T00:00:00Z"), completedAt: null,
      deferOwnerPrincipal: null, epic: null, digitalProduct: null, organization: null,
      productLine: null, businessProduct: null, demandEvidenceLinks: [], activities: [],
    });
    mocks.loadBacklogWorkroomOwnership.mockResolvedValue({ workrooms: [active], liveWorkrooms: [active] });

    const result = await getBacklogItem({ itemId: "BI-WORKROOM" });

    expect(result).toMatchObject({ success: true, data: { workrooms: [active], activeWorkrooms: [active] } });
  });

  it("exposes the same PIR recovery resolver on a read without attempting completion", async () => {
    mocks.findUnique.mockResolvedValue({
      ...baseItem, id: "row-bi", status: "in-progress", body: null,
      createdAt: new Date("2026-09-21T00:00:00Z"), completedAt: null,
      deferOwnerPrincipal: null, epic: null, digitalProduct: null, organization: null,
      productLine: null, businessProduct: null, demandEvidenceLinks: [], activities: [],
    });
    const completion = { verdict: "input-required", blockers: [], unmet: [{ code: "POST_IMPLEMENTATION_REVIEW_REQUIRED" }] };
    const recovery = { reviewerRoutes: [{ gate: "post-implementation-review" }], escalations: [], unroutable: [] };
    mocks.projectReadiness.mockReturnValue({ decisions: { completion } });
    mocks.resolveTerminalRecovery.mockResolvedValue(recovery);
    const result = await getBacklogItem({ itemId: baseItem.itemId });
    expect(mocks.resolveTerminalRecovery).toHaveBeenCalledWith({ decision: completion, currentAgentId: null, refusedWorkroomId: null });
    expect(result).toMatchObject({ success: true, data: { recovery } });
  });

  it("returns one exact bounded packet for a large six-gate item without its body or other packets", async () => {
    mocks.findUnique.mockResolvedValue({
      ...baseItem, id: "row-bi", status: "in-progress", body: "large context ".repeat(10_000),
      createdAt: new Date("2026-09-21T00:00:00Z"), completedAt: null,
      deferOwnerPrincipal: null, epic: null, digitalProduct: null, organization: null,
      productLine: null, businessProduct: null, demandEvidenceLinks: [], activities: [],
    });
    const gates = ["plan-review", "design-spec", "spec-approval", "architecture-review", "data-review", "ux-fit-review"];
    const completion = { verdict: "input-required", shapeDecision: { effective: "large" }, blockers: [],
      unmet: gates.map((_, i) => ({ code: i ? "REVIEW_REQUIRED" : "PLAN_REVIEW_REQUIRED" })) };
    const routes = gates.map(gate => ({ gate, workroomId: "WC-BOUND", requestCoworker: {
      requestKey: `immutable:${gate}`, targetAgent: "AGT-REVIEW", objective: "Read immutable evidence. ".repeat(60),
      initiativeReviewBinding: { itemId: baseItem.itemId, gate, headSha: "a".repeat(40) },
    } }));
    mocks.projectReadiness.mockReturnValue({ decisions: { completion } });
    mocks.resolveTerminalRecovery.mockResolvedValue({ reviewerRoutes: routes, escalations: [], unroutable: [] });
    const first = await getBacklogItem({ itemId: baseItem.itemId, recoveryGate: "plan-review" }, "AGT-AUTHOR", "user-1");
    expect(first).toMatchObject({ success: true, data: {
      itemId: baseItem.itemId, recovery: { reviewerRoutes: [routes[0]] },
    } });
    expect(first.data).not.toHaveProperty("body");
    expect(first.data).not.toHaveProperty("recentActivity");
    expect(JSON.stringify(first).length).toBeLessThanOrEqual(8_000);
    const second = await getBacklogItem({ itemId: baseItem.itemId, recoveryGate: "plan-review" }, "AGT-AUTHOR", "user-1");
    expect(second.data?.recovery).toEqual(first.data?.recovery);
    expect(mocks.resolveTerminalRecovery).toHaveBeenCalledWith(expect.objectContaining({
      decision: completion, currentAgentId: "AGT-AUTHOR", currentUserId: "user-1",
    }));
    expect(mocks.roomIdentity).toHaveBeenCalledWith({ where: { capsuleId: "WC-BOUND" }, select: { id: true } });
    expect(mocks.roomAccess).toHaveBeenCalledWith({ userId: "user-1", agentId: "AGT-AUTHOR", workroomId: "relational-room-row", requested: "content" });
    mocks.roomIdentity.mockResolvedValue(null);
    mocks.roomAccess.mockClear();
    const missing = await getBacklogItem({ itemId: baseItem.itemId, recoveryGate: "plan-review" }, "AGT-AUTHOR", "user-1");
    expect(missing).toMatchObject({ success: false, error: "workroom_data_access_required" });
    expect(mocks.roomAccess).not.toHaveBeenCalled();
    mocks.roomIdentity.mockResolvedValue({ id: "relational-room-row" });
    const human = await getBacklogItem({ itemId: baseItem.itemId, recoveryGate: "plan-review" }, null, "user-1");
    expect(human.success).toBe(true);
    expect(mocks.roomAccess).toHaveBeenCalledWith({ userId: "user-1", workroomId: "relational-room-row", requested: "content" });
    const missingCaller = await getBacklogItem({ itemId: baseItem.itemId, recoveryGate: "plan-review" }, "AGT-AUTHOR");
    expect(missingCaller).toMatchObject({ success: false, error: "workroom_data_access_required" });
    mocks.roomAccess.mockResolvedValue({ decision: { level: "none" } });
    const denied = await getBacklogItem({ itemId: baseItem.itemId, recoveryGate: "plan-review" }, "AGT-AUTHOR", "user-1");
    expect(denied).toMatchObject({ success: false, error: "workroom_data_access_required" });
    expect(denied.data ?? {}).not.toHaveProperty("recovery");
  });

  it("offers author-owned research recovery even when six pre-delivery gates are unmet", async () => {
    mocks.findUnique.mockResolvedValue({
      ...baseItem, id: "row-bi", status: "open", body: null,
      createdAt: new Date("2026-09-21T00:00:00Z"), completedAt: null,
      deferOwnerPrincipal: null, epic: null, digitalProduct: null, organization: null,
      productLine: null, businessProduct: null, demandEvidenceLinks: [], activities: [],
    });
    const plan = { verdict: "input-required", shapeDecision: { effective: "large" }, blockers: [],
      unmet: ["RESEARCH_REQUIRED", "CANONICAL_DESIGN_REQUIRED", "SPEC_APPROVAL_REQUIRED", "REVIEW_REQUIRED",
        "OBJECTIVE_BASELINE_REQUIRED", "ARTIFACT_AUTHOR_REQUIRED"].map(code => ({ code })) };
    mocks.projectReadiness.mockReturnValue({ decisions: { plan } });
    const recovery = { reviewerRoutes: [], unroutable: [], escalations: [{
      reason: "research-evidence-required", toolName: "record_initiative_evidence", accountableRole: "design-author",
    }] };
    mocks.resolveTerminalRecovery.mockResolvedValue(recovery);
    const result = await getBacklogItem({ itemId: baseItem.itemId, recoveryGate: "research" }, "AGT-AUTHOR", "user-1");
    expect(result).toMatchObject({ success: true, data: { recovery } });
    expect(mocks.resolveTerminalRecovery).toHaveBeenCalledWith(expect.objectContaining({ decision: plan }));
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(8_000);
  });

  it("uses the trusted OAuth task family so a retained exhausted plan packet is not issued again", async () => {
    mocks.findUnique.mockResolvedValue({ ...baseItem, id: "row-bi", status: "open", body: null,
      createdAt: new Date("2026-09-21T00:00:00Z"), completedAt: null, deferOwnerPrincipal: null,
      epic: null, digitalProduct: null, organization: null, productLine: null, businessProduct: null,
      demandEvidenceLinks: [], activities: [],
    });
    const decision: InitiativeReadinessDecision = {
      decisionId: "IRD-PLAN", policyVersion: "initiative-readiness.v3", subject: { kind: "backlog-item", id: baseItem.itemId },
      transitionObject: { kind: "work-capsule", id: "WC-BOUND", expectedVersion: "claim.v1", targetState: "implementation" },
      profile: "feature", target: "implementation", verdict: "input-required", satisfied: [], blockers: [],
      unmet: [readinessRequirement({ code: "PLAN_REVIEW_REQUIRED", state: "missing", accountableRole: "plan-reviewer" })],
      evaluatedAt: "2026-10-16T00:00:00Z",
    };
    const history = vi.fn();
    const issue = (taskAuthority: { userId: string; taskAuthorityKey: string } | null) => resolveInitiativeReviewerRecovery({
      decision, currentAgentId: "AGT-AUTHOR", expectedCurrentBaselineId: "BASE-ONE",
      dispatchContext: { workroomId: "WC-BOUND", repositoryFullName: "org/repo", branchName: "fix/one", headSha: "a".repeat(40) },
      planArtifact: { resolved: true, path: "docs/superpowers/plans/one.md", commitSha: "b".repeat(40), providerBlobId: "c".repeat(40) },
      db: { agentToolGrant: { findMany: async () => ["AGT-A", "AGT-B"].flatMap(agentId =>
        ["initiative_design_review", "file_read"].map(grantKey => ({ grantKey, agent: {
          agentId, displayName: agentId, status: "active", archived: false, lifecycleStage: "production",
        } }))) } },
      isPlanReviewExhausted: createExhaustedPlanReviewPredicate(taskAuthority, { taskRun: { findFirst: history } }),
    });
    const oldPacket = (await issue(null)).reviewerRoutes[0]!.requestCoworker;
    const authority = { userId: "user-1", taskAuthorityKey: "oauth-family:one" };
    const authorityScope = ["initiative_evidence_write", `backlog-item:${baseItem.itemId}`, ...oldPacket.requiredToolNames!.map(name => `tool:${name}`)];
    const submitted = { agentId: oldPacket.targetAgent, objective: oldPacket.objective, prompt: oldPacket.objective,
      title: oldPacket.questionPacketSummary, idempotencyKey: oldPacket.requestKey, routeContext: "/build",
      riskClass: "bounded-write" as const, collaborationKind: "handoff" as const, authorityScope,
      initiativeReviewBinding: oldPacket.initiativeReviewBinding };
    history.mockResolvedValue({ taskRunId: deterministicExternalTaskRunId(authority.taskAuthorityKey, oldPacket.requestKey),
      userId: "user-1", currentAgentId: "AGT-A", status: "input-required", authorityScope,
      a2aMetadata: { taskAuthorityKey: authority.taskAuthorityKey, idempotencyKey: oldPacket.requestKey,
        requestedAgentId: "AGT-A", requestDigestVersion: 2, requestDigest: remoteTaskRequestDigest(submitted) },
      progressPayload: { terminalWriterWait: { schemaVersion: 1, kind: "missing-terminal-writer",
        writerToolName: "record_initiative_design_review", resumeMode: "same-taskrun", dispatchContract: "required-tool-call", attempt: 3, observedAt: "2026-10-16T00:00:00Z" } },
    });
    const validator = await issue(authority);
    expect(validator.reviewerRoutes[0]!.requestCoworker.targetAgent).toBe("AGT-B");
    mocks.projectReadiness.mockReturnValue({ decisions: { implementation: decision, completion: decision } });
    mocks.resolveTerminalRecovery.mockImplementation(({ taskAuthority }) => issue(taskAuthority ?? null));
    const params = { itemId: baseItem.itemId, recoveryGate: "plan-review", taskAuthorityKey: "untrusted-client-family" };
    const context = { authSource: "oauth", apiTokenId: "token-row" };
    const read = await Reflect.apply(getBacklogItem, undefined, [params, "AGT-AUTHOR", "user-1", context]);
    expect(read.data.recovery.reviewerRoutes).toEqual(validator.reviewerRoutes);
    expect(read.data.recovery.reviewerRoutes[0].requestCoworker).not.toEqual(oldPacket);
    expect(mocks.taskAuthority).toHaveBeenCalledWith({ tokenId: "token-row", userId: "user-1", source: "oauth" });
    mocks.taskAuthority.mockResolvedValue(null);
    const revoked = await Reflect.apply(getBacklogItem, undefined, [params, "AGT-AUTHOR", "user-1", context]);
    expect(revoked).toMatchObject({ success: false, error: "review_task_authority_unavailable" });
    expect(revoked.data ?? {}).not.toHaveProperty("recovery");
  });

  it.each(["OBJECTIVE_RECONCILIATION_REQUIRED", "ACCEPTANCE_EVIDENCE_REQUIRED", "PLAN_REVIEW_REQUIRED"])(
    "exposes canonical completion recovery for %s without attempting a transition", async (code) => {
      mocks.findUnique.mockResolvedValue({
        ...baseItem, id: "row-bi", status: "in-progress", body: null,
        createdAt: new Date("2026-09-21T00:00:00Z"), completedAt: null,
        deferOwnerPrincipal: null, epic: null, digitalProduct: null, organization: null,
        productLine: null, businessProduct: null, demandEvidenceLinks: [], activities: [],
      });
      const completion = { verdict: "input-required", blockers: [], unmet: [{ code }] };
      const recovery = { reviewerRoutes: [], escalations: [{ reason: "eligible-evidence-not-found" }], unroutable: [] };
      mocks.projectReadiness.mockReturnValue({ decisions: { completion } });
      mocks.resolveTerminalRecovery.mockResolvedValue(recovery);
      const result = await getBacklogItem({ itemId: baseItem.itemId }, "AGT-AUTHOR", "user-1");
      expect(mocks.resolveTerminalRecovery).toHaveBeenCalledWith(expect.objectContaining({
        decision: completion, currentAgentId: "AGT-AUTHOR", currentUserId: "user-1", refusedWorkroomId: null,
      }));
      expect(result).toMatchObject({ success: true, data: { recovery } });
    },
  );

  it("passes the persisted terminal readiness decision through the canonical item read", async () => {
    const terminalActivity = {
      id: "activity-terminal",
      kind: "initiative_readiness_decision",
      gateKey: null,
      recordedAt: new Date("2026-08-31T17:26:02.028Z"),
      payload: { schemaVersion: 1, target: "completion", verdict: "allowed" },
    };
    mocks.findUnique.mockResolvedValue({
      ...baseItem,
      id: "row-bi",
      itemId: "BI-COMPLETE",
      title: "Completed work",
      status: "done",
      body: null,
      createdAt: new Date("2026-08-01T00:00:00Z"),
      completedAt: new Date("2026-08-31T17:26:02.028Z"),
      deferOwnerPrincipal: null,
      epic: null,
      digitalProduct: null,
      organization: null,
      productLine: null,
      businessProduct: null,
      demandEvidenceLinks: [],
      activities: [terminalActivity],
    });
    mocks.projectReadiness.mockReturnValue({
      governed: true,
      artifactHints: { hasSpec: true, hasPlan: true },
      decisions: { completion: { verdict: "allowed" } },
    });

    const result = await getBacklogItem({ itemId: "BI-COMPLETE" });

    expect(result).toMatchObject({
      success: true,
      data: { status: "done", readiness: { decisions: { completion: { verdict: "allowed" } } } },
    });
    expect(mocks.projectReadiness).toHaveBeenCalledWith(expect.objectContaining({
      item: expect.objectContaining({ itemId: "BI-COMPLETE", status: "done" }),
      activities: [terminalActivity],
    }));
  });

  // BI-094B41AC: the completion decision a read returns for an item awaiting
  // acceptance is the completion gate's own evaluation, merge signal included.
  function awaitingItem() {
    return {
      ...baseItem, id: "row-aa", itemId: "BI-AWAIT", status: "awaiting-acceptance", body: null,
      createdAt: new Date("2026-10-01T00:00:00Z"), completedAt: null,
      deferOwnerPrincipal: null, epic: null, digitalProduct: null, organization: null,
      productLine: null, businessProduct: null, demandEvidenceLinks: [], activities: [],
    };
  }

  it("reads an awaiting-acceptance item's completion from the completion gate's evaluation", async () => {
    mocks.findUnique.mockResolvedValue(awaitingItem());
    const gateDecision = { verdict: "allowed", profile: "fix", blockers: [], unmet: [] };
    mocks.readCompletion.mockResolvedValue({ decision: gateDecision, mergedThroughGates: "merged" });
    mocks.projectReadiness.mockImplementation((args: { completionDecision?: unknown }) => ({
      decisions: { completion: args.completionDecision ?? { verdict: "input-required", blockers: [], unmet: [] } },
    }));

    const result = await getBacklogItem({ itemId: "BI-AWAIT" });

    expect(mocks.readCompletion).toHaveBeenCalledWith(expect.objectContaining({ itemRowId: "row-aa", status: "awaiting-acceptance" }));
    expect(mocks.projectReadiness).toHaveBeenCalledWith(expect.objectContaining({ completionDecision: gateDecision }));
    expect(result).toMatchObject({
      success: true,
      data: { readiness: {
        decisions: { completion: { verdict: "allowed" } },
        completionEvaluation: { source: "completion-gate", mergeDelivery: "merged" },
      } },
    });
  });

  it("names an unavailable merge signal on the read instead of reporting it as a negative", async () => {
    mocks.findUnique.mockResolvedValue(awaitingItem());
    const refusal = { verdict: "input-required", profile: "fix", blockers: [], unmet: [{ code: "DELIVERY_EVIDENCE_REQUIRED" }] };
    mocks.readCompletion.mockResolvedValue({ decision: refusal, mergedThroughGates: "signal-unavailable" });
    mocks.projectReadiness.mockImplementation((args: { completionDecision?: unknown }) => ({
      decisions: { completion: args.completionDecision },
    }));

    const result = await getBacklogItem({ itemId: "BI-AWAIT" });

    expect(result).toMatchObject({
      data: { readiness: {
        decisions: { completion: { verdict: "input-required" } },
        completionEvaluation: { source: "completion-gate", mergeDelivery: "signal-unavailable" },
      } },
    });
  });

  it("keeps the existing projection when the gate's evaluation is not available", async () => {
    mocks.findUnique.mockResolvedValue(awaitingItem());
    mocks.readCompletion.mockResolvedValue(null);
    mocks.projectReadiness.mockReturnValue({ decisions: { completion: { verdict: "input-required", blockers: [], unmet: [] } } });

    const result = await getBacklogItem({ itemId: "BI-AWAIT" });

    expect(mocks.projectReadiness).toHaveBeenCalledWith(expect.objectContaining({ completionDecision: null }));
    expect((result.data as { readiness: Record<string, unknown> }).readiness).not.toHaveProperty("completionEvaluation");
  });

  // BI-DEDAC950: the read projection names the principle behind each unmet
  // code per target, beside `decisions` and never inside a decision.
  it("cites governing principles per readiness target beside the decisions", async () => {
    mocks.findUnique.mockResolvedValue({
      ...baseItem, id: "row-bi", status: "in-progress", body: null,
      createdAt: new Date("2026-09-25T00:00:00Z"), completedAt: null,
      deferOwnerPrincipal: null, epic: null, digitalProduct: null, organization: null,
      productLine: null, businessProduct: null, demandEvidenceLinks: [], activities: [],
    });
    const completion = { verdict: "input-required", profile: "feature", blockers: [], unmet: [{ code: "DELIVERY_EVIDENCE_REQUIRED" }] };
    const implementation = { verdict: "allowed", profile: "feature", blockers: [], unmet: [] };
    mocks.projectReadiness.mockReturnValue({ decisions: { implementation, completion } });

    const result = await getBacklogItem({ itemId: baseItem.itemId });

    expect(result).toMatchObject({
      success: true,
      data: {
        readiness: {
          decisions: { implementation, completion },
          governingPrinciples: {
            implementation: {},
            completion: { DELIVERY_EVIDENCE_REQUIRED: "principles/build-gate-mandatory" },
          },
        },
      },
    });
    expect(completion).not.toHaveProperty("governingPrinciples");
  });

  it("builds the nonconformant filter from the canonical projection fields", async () => {
    await listBacklogItems({ deferralConformance: "nonconformant" });

    expect(mocks.count).toHaveBeenCalledWith({
      where: {
        status: "deferred",
        OR: [
          { deferReason: null },
          { deferTrigger: null },
          { deferReviewAt: null },
          { deferOwnerPrincipalId: null },
          { deferredAt: null },
        ],
      },
    });
  });

  it("returns compliant owner, trigger, and review data without another query", async () => {
    mocks.findMany.mockResolvedValue([{
      ...baseItem,
      deferReason: "Waiting for the predecessor",
      deferTrigger: "The predecessor ships",
      deferReviewAt: new Date("2099-11-15T12:00:00Z"),
      deferOwnerPrincipalId: "principal-row-1",
      deferredAt: new Date("2026-08-15T12:00:00Z"),
      deferOwnerPrincipal: { principalId: "PRN-OWNER", displayName: "Portfolio owner" },
    }]);

    const result = await listBacklogItems({ deferralConformance: "compliant" });
    const item = (result.data as { items: Array<{ deferral: unknown }> }).items[0];

    expect(item?.deferral).toEqual({
      reason: "Waiting for the predecessor",
      trigger: "The predecessor ships",
      reviewAt: "2099-11-15T12:00:00.000Z",
      deferredAt: "2026-08-15T12:00:00.000Z",
      owner: { principalId: "PRN-OWNER", displayName: "Portfolio owner" },
      conformant: true,
      reviewDue: false,
    });
    expect(mocks.findMany).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid review horizon before querying the backlog", async () => {
    const result = await listBacklogItems({ deferralReviewDueBefore: "not-a-date" });

    expect(result).toMatchObject({ success: false, error: "invalid_deferral_review_due_before" });
    expect(mocks.count).not.toHaveBeenCalled();
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  // BI-10C34BE1: with no docs/superpowers tree every epic reads hasSpec:false /
  // hasPlan:false. That is indistinguishable from a genuinely undesigned
  // backlog, so the response has to say the measurement did not happen.
  it("states that spec/plan coverage was not measured when the corpus is absent", async () => {
    mocks.countEpics.mockResolvedValue(1);
    mocks.findEpics.mockResolvedValue([{
      id: "epic-row",
      epicId: "EP-NO-CORPUS",
      title: "Undesigned looking",
      status: "open",
      priority: 1,
      updatedAt: new Date("2026-08-26T00:00:00.000Z"),
      scopeKind: "platform",
      archetypeCategories: [],
      archetypeIds: [],
      scopeRationale: null,
      lifecycleTags: [],
      items: [],
    }]);
    const corpusAbsent = { ...CORPUS_AVAILABLE, available: false, fileCount: 0 };
    mocks.buildReferenceIndex.mockResolvedValue({
      specs: new Set(),
      plans: new Set(),
      corpus: corpusAbsent,
    });
    mocks.specPlanCorpusCaveat.mockReturnValue("Spec/plan coverage was NOT measured: no corpus.");

    const { listEpics } = await import("./backlog-pack-read-tools");
    const result = await listEpics({});

    expect(result.message).toContain("NOT measured");
    expect((result.data as { specPlanCorpus: { available: boolean } }).specPlanCorpus.available).toBe(false);
  });
});
