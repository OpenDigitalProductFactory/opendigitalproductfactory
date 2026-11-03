import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  item: vi.fn(), readiness: vi.fn(), recovery: vi.fn(), history: vi.fn(), historyMany: vi.fn(), authority: vi.fn(),
  access: vi.fn(), design: vi.fn(), itemFirst: vi.fn(), activities: vi.fn(), rooms: vi.fn(), room: vi.fn(),
  collect: vi.fn(), completion: vi.fn(),
}));
vi.mock("@dpf/db", () => ({ prisma: {
  backlogItem: { findUnique: mocks.item, findFirst: mocks.itemFirst },
  backlogItemActivity: { findMany: mocks.activities },
  workroom: { findUnique: vi.fn().mockResolvedValue({ id: "room-row" }),
    findFirst: mocks.room, findMany: mocks.rooms },
  agent: { findUnique: vi.fn().mockResolvedValue({ status: "active", archived: false,
    toolGrants: [{ grantKey: "initiative_evidence_write" }] }) },
  mcpApiToken: { findUnique: vi.fn().mockResolvedValue({ userId: "human", agentId: "AGT-AUTHOR",
    authorityBindingId: "consent", oauthClient: { registrationKind: "dynamic" } }) },
  taskRun: { findFirst: mocks.history, findMany: mocks.historyMany },
} }));
vi.mock("@/lib/backlog/spec-plan-search", () => ({
  searchSpecsAndPlans: vi.fn().mockResolvedValue({ corpus: {}, results: [] }), specPlanCorpusCaveat: () => null,
}));
vi.mock("@/lib/work-capsules/backlog-workroom-ownership", () => ({
  loadBacklogWorkroomOwnership: vi.fn().mockResolvedValue({ workrooms: [], liveWorkrooms: [] }),
}));
vi.mock("@/lib/demand/demand-data", () => ({ mapDemandRows: () => [{ activation: null, evidenceLinks: [] }] }));
vi.mock("@/lib/backlog/initiative-readiness/entry-adapter", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/backlog/initiative-readiness/entry-adapter")>(),
  projectBacklogItemReadinessSummary: mocks.readiness,
}));
vi.mock("@/lib/backlog/initiative-readiness/backlog-completion-evaluation", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/backlog/initiative-readiness/backlog-completion-evaluation")>(),
  readBacklogItemCompletion: mocks.completion,
}));
vi.mock("@/lib/backlog/initiative-readiness/body-baseline-author-room", () => ({
  resolveBodyBaselineAuthorRoom: (...args: unknown[]) => mocks.room(...args),
  isCurrentDeliveredBodyAuthor: async () => true,
}));
vi.mock("@/lib/backlog/initiative-readiness/canonical-artifact-discovery", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/backlog/initiative-readiness/canonical-artifact-discovery")>(),
  prepareCurrentDesignObservation: mocks.design,
}));
vi.mock("@/lib/backlog/initiative-readiness/terminal-recovery", () => ({ resolveTerminalInitiativeRecovery: mocks.recovery }));
vi.mock("@/lib/work-management/workroom-agent-access.server", () => ({
  resolveAgentWorkroomAccess: mocks.access, resolveHumanWorkroomAccess: mocks.access,
}));
vi.mock("@/lib/auth/oauth-task-authority", () => ({ resolveMcpTaskAuthorityKey: mocks.authority }));
vi.mock("@/lib/govern/current-user-context", () => ({ currentUserContext: async () => ({ isSuperuser: true, platformRole: null }) }));
vi.mock("@/lib/auth/oauth-tokens", () => ({ OAUTH_EXECUTION_AUTHORITY_SELECT: {}, isCurrentOAuthExecutionAuthority: async () => true }));
vi.mock("@/lib/mcp-task-review-outcome", () => ({ loadTaskInitiativeReviewOutcome: async () => null }));
vi.mock("@/lib/mcp-task-review-document", () => ({ reviewDocumentPreflight: async () => ({ refusal: null, notice: null }) }));
vi.mock("@/lib/mcp-task-original-result", () => ({ readOriginalReviewResult: mocks.collect }));

import { getBacklogItem } from "./packs/backlog-pack-read-tools";
import { authorizeCoworkerRequest } from "./independent-review-request";
import { resolveInitiativeReviewerRecovery } from "@/lib/tak/initiative-readiness-tool-grants";
import { createExhaustedPlanReviewPredicate } from "@/lib/backlog/initiative-readiness/exhausted-plan-review";
import { readinessRequirement } from "@/lib/backlog/initiative-readiness/readiness-guidance";
import type { InitiativeReadinessDecision } from "@/lib/backlog/initiative-readiness/types";
import { deterministicExternalTaskRunId, remoteTaskRequestDigest } from "@/lib/mcp-task-capacity-contract";
import type { ToolExecutionContext, ToolResult } from "@/lib/mcp-tool-types";
import type { InitiativeReviewerRecovery } from "@/lib/tak/initiative-readiness-tool-grants";

const context: ToolExecutionContext = { agentId: "AGT-AUTHOR", apiTokenId: "access", authSource: "oauth", tokenScope: "write",
  tokenGrantScopes: ["initiative_evidence_write"] };
const authority = { userId: "human", taskAuthorityKey: "oauth-family:roundtrip" };
const gates = [
  ["design-spec", "CANONICAL_DESIGN_REQUIRED", "design-checklist-reviewer"],
  ["spec-approval", "SPEC_APPROVAL_REQUIRED", "design-checklist-reviewer"],
  ["architecture-review", "REVIEW_REQUIRED", "architecture-reviewer"],
  ["plan-review", "PLAN_REVIEW_REQUIRED", "plan-reviewer"],
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.completion.mockReset().mockResolvedValue(null);
  mocks.itemFirst.mockReset().mockResolvedValue(null);
  mocks.activities.mockReset().mockResolvedValue([]);
  mocks.rooms.mockReset().mockResolvedValue([]);
  mocks.room.mockReset().mockResolvedValue({ id: "room-row", backlogItemId: "BI-ROUNDTRIP", executorKind: "codex-desktop",
    repositoryFullName: "org/repo", headBranch: "feat/roundtrip", baseSha: "e".repeat(40), headSha: "a".repeat(40) });
  mocks.design.mockReset().mockResolvedValue({ evidence: { state: "not-applicable" } });
  mocks.history.mockResolvedValue(null);
  mocks.historyMany.mockResolvedValue([]);
  mocks.collect.mockResolvedValue({ schemaVersion: 1, classification: "unknown", readOnly: true,
    replayAllowed: false, reason: "Child closure remains unverified.", observations: [], missingProof: ["child-closure"], bounded: true });
  mocks.authority.mockResolvedValue(authority.taskAuthorityKey);
  mocks.access.mockImplementation(async ({ requested }) => ({ decision: { level: requested } }));
  mocks.item.mockResolvedValue({ id: "item-row", itemId: "BI-ROUNDTRIP", title: "Current review", status: "open",
    type: "portfolio", workType: "feature", source: "user-request", priority: 1, effortSize: "large", scopeKind: "platform",
    body: null, createdAt: new Date("2026-10-16T00:00:00Z"), updatedAt: new Date("2026-10-16T00:00:00Z"),
    completedAt: null, archetypeCategories: [], archetypeIds: [], lifecycleTags: [], activities: [], demandEvidenceLinks: [],
    deferOwnerPrincipal: null, epic: null, digitalProduct: null, organization: null, productLine: null, businessProduct: null, activeBuild: null });
});

function prepare(gate: readonly [typeof gates[number][0], typeof gates[number][1], typeof gates[number][2]]) {
  const decision: InitiativeReadinessDecision = {
    decisionId: "IRD-ROUNDTRIP", policyVersion: "initiative-readiness.v3", subject: { kind: "backlog-item", id: "BI-ROUNDTRIP" },
    transitionObject: { kind: "work-capsule", id: "WC-ROUNDTRIP", expectedVersion: "claim.v1", targetState: "implementation" },
    profile: "feature", target: "implementation", verdict: "input-required", satisfied: [], blockers: [],
    unmet: [readinessRequirement({ code: gate[1], state: "missing", accountableRole: gate[2] })], evaluatedAt: "2026-10-16T00:00:00Z",
  };
  mocks.readiness.mockReturnValue({ decisions: { plan: decision, implementation: decision, completion: decision } });
  const input = { decision, currentAgentId: "AGT-AUTHOR", expectedCurrentBaselineId: null,
    dispatchContext: { workroomId: "WC-ROUNDTRIP", repositoryFullName: "org/repo", branchName: "feat/roundtrip", headSha: "a".repeat(40) },
    canonicalArtifact: { resolved: true as const, path: "docs/superpowers/specs/roundtrip.md", providerBlobId: "b".repeat(40) },
    planArtifact: { resolved: true as const, path: "docs/superpowers/plans/roundtrip.md", commitSha: "a".repeat(40), providerBlobId: "c".repeat(40) },
    db: { agentToolGrant: { findMany: async () => ["initiative_design_review", "initiative_architecture_review", "file_read"].map(grantKey => ({
      grantKey, agent: { agentId: "AGT-REVIEWER", displayName: "Reviewer", status: "active", archived: false, lifecycleStage: "production" },
    })) } },
  };
  const issue = (taskAuthority: typeof authority | null) => resolveInitiativeReviewerRecovery({ ...input,
    ...(taskAuthority ? { isPlanReviewExhausted: createExhaustedPlanReviewPredicate(taskAuthority, { taskRun: { findFirst: mocks.history } }) } : {}),
  });
  mocks.recovery.mockImplementation(({ taskAuthority }) => issue(taskAuthority ?? null));
  return { issue };
}

describe("bounded recovery packet round trip", () => {

  it("BI-5B0CD1BC admits the exact packet from typed completion after author archival", async () => {
    const evaluation = await vi.importActual<typeof import("@/lib/backlog/initiative-readiness/backlog-completion-evaluation")>(
      "@/lib/backlog/initiative-readiness/backlog-completion-evaluation");
    const terminal = await vi.importActual<typeof import("@/lib/backlog/initiative-readiness/terminal-recovery")>(
      "@/lib/backlog/initiative-readiness/terminal-recovery");
    const entry = await vi.importActual<typeof import("@/lib/backlog/initiative-readiness/entry-adapter")>(
      "@/lib/backlog/initiative-readiness/entry-adapter");
    const { completeBacklogItemTransition } = await import("@/lib/backlog/initiative-readiness/backlog-terminal-transition");
    const { bodyCriteriaVersion } = await import("@/lib/backlog/initiative-readiness/body-baseline-version");
    const { readyActivities } = await import("@/lib/backlog/initiative-readiness/entry-adapter.test-fixtures");
    const now = new Date();
    const body = "## Acceptance\n- Preserve native observation failures.";
    const room = { ...await mocks.room(), capsuleId: "WC-ROUNDTRIP", status: "archived",
      createdByPrincipalId: "author-principal", createdAt: new Date(now.getTime() - 6000),
      scopeClaims: [{ source: "declared", workShape: "delivery-medium@1.0.0" }] };
    const baseline = { schemaVersion: 1, baselineId: "baseline-body", supersedesBaselineId: null, profile: "fix",
      artifactRole: "problem-statement", approvalReceiptId: null,
      origin: "item-body", authorAgentId: "AGT-AUTHOR", bodyAuthorPrincipalId: "author-principal",
      sourceAuthorPrincipalId: "author-principal", artifactDigest: "sha256:body",
      subject: { kind: "backlog-item", id: "BI-ROUNDTRIP" }, authoritySnapshot: { organizationId: "platform" },
      criteriaDigest: bodyCriteriaVersion(body)!.criteriaDigest, objectiveStatements: [],
      acceptanceStatements: bodyCriteriaVersion(body)!.acceptanceStatements,
      sourceIdentity: { repositoryFullName: room.repositoryFullName, headSha: room.headSha },
      artifactRef: { kind: "document-version", repositoryFullName: room.repositoryFullName,
        versionId: "body-version", valueDigest: "sha256:body" } };
    const item = { ...await mocks.item(), status: "awaiting-acceptance", workType: "bug", type: "product",
      effortSize: "medium", body, organizationId: null, epicId: null, digitalProductId: null,
      claimedAt: new Date(now.getTime() - 6000), createdAt: new Date(now.getTime() - 6000), productObjectiveWork: [] };
    const rows: Array<Record<string, any>> = [
      ...readyActivities().filter(row => row.gateKey === "research").map(row => ({
        ...row, backlogItemId: item.id, payload: { ...row.payload, subject: baseline.subject, profile: "fix" } })),
      { id: "body-baseline", backlogItemId: item.id, kind: "initiative_scope_baseline", gateKey: null,
        recordedAt: new Date(now.getTime() - 4000), payload: baseline },
      ...["source_verified", "test_pass", "build_pass"].map((evidenceKind, i) => ({
        id: "E-" + i, backlogItemId: item.id, kind: "evidence", gateKey: null,
        recordedAt: new Date(now.getTime() - 2000), payload: {
          evidenceKind, url: "https://github.com/org/repo/actions/runs/123", summary: "Recorded check" } })),
    ];
    const findRows = async ({ where, take }: any) => {
      let selected = rows.filter(row => typeof where?.kind === "string" ? row.kind === where.kind
        : where?.kind?.in ? where.kind.in.includes(row.kind) : true);
      selected = [...selected].sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime());
      return take ? selected.slice(0, take) : selected;
    };
    mocks.item.mockResolvedValue(item); mocks.itemFirst.mockResolvedValue(item);
    mocks.room.mockResolvedValue(room);
    mocks.rooms.mockImplementation(async ({ where }: any) => where.archivedAt === null ? [] : [room]);
    mocks.activities.mockImplementation(findRows);
    mocks.readiness.mockImplementation(entry.projectBacklogItemReadinessSummary);
    const client = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
      backlogItem: { findUnique: mocks.item, findFirst: mocks.itemFirst, updateMany: vi.fn(async () => ({ count: 1 })) },
      backlogItemActivity: { findMany: mocks.activities, create: vi.fn(async ({ data }: any) => {
        const row = { ...data, id: "attempt-" + rows.length, recordedAt: new Date() }; rows.unshift(row); return row;
      }) },
      workroom: { findFirst: mocks.room, findMany: mocks.rooms },
      authorizationDecisionLog: { create: vi.fn(async (args: unknown) => args) },
    };
    const dependencies = {
      prepareCurrentDesign: async () => ({ evidence: { state: "not-applicable" as const },
        admissionGuard: async () => ({ state: "not-applicable" as const }) }),
      resolveMergeDelivery: async () => "signal-unavailable" as const,
      resolveDeploymentClosure: async () => ({ kind: "unavailable" as const, reason: "Consumer install" }),
    };
    mocks.completion.mockImplementation((args: any) => evaluation.readBacklogItemCompletion({
      ...args, db: client as never, dependencies }));
    mocks.recovery.mockImplementation((args: Parameters<typeof terminal.resolveTerminalInitiativeRecovery>[0]) =>
      terminal.resolveTerminalInitiativeRecovery({ ...args, ports: {
        ...terminal.DEFAULT_TERMINAL_RECOVERY_PORTS,
        loadLiveRooms: async () => [], loadDeliveredBodyAuthor: async () => ({ ...room, isLive: false }),
        loadBaselinePayloads: async () => [baseline],
        validateBodyBaselineCurrent: async () => true,
        bodyReviewerCanRead: async ({ agentId }) =>
          (await mocks.access({ requested: "content", agentId })).decision.level === "content",
        loadEligibleEvidenceActivityIds: async () => ({ ok: true, data: { activityIds: ["E-0", "E-1", "E-2"] } }),
        loadObjectiveMappingHistory: async () => ({ ok: true, data: { history: [] } }),
        resolveRecovery: input => resolveInitiativeReviewerRecovery({ ...input, db: { agentToolGrant: {
          findMany: async () => ["initiative_evidence_write", "file_read"].map(grantKey => ({ grantKey,
            agent: { agentId: "AGT-132", displayName: "Release Acceptance", status: "active",
              archived: false, lifecycleStage: "production" } })),
        } } }),
      } }));
    const result = await completeBacklogItemTransition({
      db: { $transaction: async (work: (tx: typeof client) => Promise<unknown>) => work(client) } as never,
      itemId: item.itemId, expectedStatus: item.status, resolution: "Source delivered; independent acceptance requested",
      completionEvidence: { workClass: "implementation", evidenceActivityIds: ["E-0", "E-1", "E-2"],
        ux: { disposition: "not-applicable", reason: "No user-facing surface changed." },
        migration: { disposition: "not-applicable", reason: "No persisted schema change." } },
      actor: { actorType: "agent", actorRef: "AGT-AUTHOR", humanContextRef: "human", agentContextRef: "AGT-AUTHOR" },
      authority: { organizationId: null, actionKey: "update_backlog_item_status", objectRef: item.itemId,
        rationale: { capability: "manage_backlog", grant: "backlog_write" },
        authoritySnapshot: { decision: "allow", effectiveHumanCapability: "manage_backlog",
          effectiveAgentGrant: "backlog_write", tokenScope: "organization", organizationId: "platform",
          actionKey: "update_backlog_item_status", policyVersion: "coworker-authority.v1" } },
      evaluatedAt: now.toISOString(), dependencies,
    });
    expect(result.ok).toBe(false);
    const decision = result.decision;
    expect(decision.shapeDecision?.effective, JSON.stringify(decision)).toBe("medium");
    expect(decision.blockers, JSON.stringify(decision)).toEqual([]);
    expect(decision.unmet.map(row => row.code)).toEqual(["ACCEPTANCE_EVIDENCE_REQUIRED"]);
    const issued = await mocks.recovery({ decision, currentAgentId: "AGT-AUTHOR", currentUserId: "human", refusedWorkroomId: null });
    const packet = issued.reviewerRoutes[0]?.requestCoworker;
    expect(packet, JSON.stringify(issued)).toBeDefined();
    const admitted = await authorizeCoworkerRequest(packet, "human", context);
    expect(admitted.refusal, JSON.stringify(admitted)).toBeUndefined();
    item.activities = rows;
    const publicRead = await getBacklogItem({ itemId: item.itemId }, "AGT-AUTHOR", "human", context);
    expect(JSON.stringify(publicRead.data?.recentActivity)).not.toContain("completionInputContext");
    const bounded = await getBacklogItem({ itemId: item.itemId, recoveryGate: "objective-mapping" }, "AGT-AUTHOR", "human", context);
    expect(packetFrom(bounded)).toEqual(packet);
    const removed = rows.splice(rows.findIndex(row => row.id === "E-1"), 1)[0]!;
    expect((await authorizeCoworkerRequest(packet, "human", context)).refusal).toBeDefined();
    rows.push(removed);
    const originalHead = room.headSha;
    room.headSha = "f".repeat(40);
    expect((await authorizeCoworkerRequest(packet, "human", context)).refusal).toBeDefined();
    room.headSha = originalHead;
    rows.unshift({ id: "new-failure", backlogItemId: item.id, kind: "evidence", recordedAt: new Date(),
      payload: { evidenceKind: "test_fail", summary: "Current test failure" } });
    expect((await authorizeCoworkerRequest(packet, "human", context)).refusal).toBeDefined();
    rows.shift();
    for (const rawManifest of [null, undefined]) {
      const invalid = await evaluation.evaluateBacklogItemCompletion({ db: client as never, item,
        rawManifest, transitionObject: decision.transitionObject, evaluatedAt: new Date().toISOString(), dependencies });
      expect(invalid.delivery).not.toBe("pass");
      expect(invalid.completionInputContext).toBeNull();
    }
    const priorAttempt = rows.find(row => row.kind === "initiative_readiness_decision")!;
    rows.unshift({ ...priorAttempt, id: "latest-invalid", recordedAt: new Date(Date.now() + 1),
      payload: { ...priorAttempt.payload, completionInputContext: null } });
    expect((await authorizeCoworkerRequest(packet, "human", context)).refusal).toBeDefined();
    rows.shift();
    mocks.access.mockResolvedValue({ decision: { level: "none" } });
    expect((await authorizeCoworkerRequest(packet, "human", context)).refusal).toBeDefined();
  });
  it.each(["amended-design", "merged-fix"])("admits the actual %s claim packet with real readiness", async scenario => {
    const mergedFix = scenario === "merged-fix";
    const canonical = await vi.importActual<typeof import("@/lib/backlog/initiative-readiness/canonical-artifact-discovery")>(
      "@/lib/backlog/initiative-readiness/canonical-artifact-discovery");
    const entry = await vi.importActual<typeof import("@/lib/backlog/initiative-readiness/entry-adapter")>(
      "@/lib/backlog/initiative-readiness/entry-adapter");
    const terminal = await vi.importActual<typeof import("@/lib/backlog/initiative-readiness/terminal-recovery")>(
      "@/lib/backlog/initiative-readiness/terminal-recovery");
    const { readyActivities } = await import("@/lib/backlog/initiative-readiness/entry-adapter.test-fixtures");
    const { database, input, actor } = await import("@/lib/work-capsules/governed-work-claim.test-fixtures");
    const { claimGovernedBacklogWorkspace } = await import("@/lib/work-capsules/governed-work-claim");
    const source = { repositoryFullName: input.repositoryFullName, headBranch: input.headBranch,
      baseSha: "3".repeat(40), headSha: "1".repeat(40) };
    const artifact = { kind: "repo-blob-at-commit" as const, repositoryFullName: source.repositoryFullName,
      commitSha: source.baseSha, path: "docs/superpowers/specs/roundtrip.md", providerBlobId: "b".repeat(40) };
    const activities = (mergedFix ? readyActivities().filter(activity => activity.gateKey === "research") : readyActivities()).map(activity => activity.kind === "initiative_scope_baseline"
      ? { ...activity, payload: { ...activity.payload, artifactRef: artifact } } : activity);
    const room = { ...source, id: "room-row", capsuleId: "WC-ENTRY", backlogItemId: input.backlogItemId,
      executorKind: "codex-desktop", archivedAt: null, status: "ready", isLive: true };
    const rooms = [room, { ...room, capsuleId: "WC-OTHER", headBranch: "feat/other" }];
    const selectRooms = async (query: unknown) => {
      const { where } = query as { where: Record<string, unknown> };
      return rooms.filter(row => ["capsuleId", "repositoryFullName", "headBranch", "baseSha", "headSha"].every(key =>
        where[key] === undefined || where[key] === row[key as keyof typeof row]));
    };
    const db = database(activities);
    Object.assign(db, { $queryRaw: vi.fn().mockResolvedValue([]) });
    vi.mocked(db.workroom.findMany).mockImplementation(selectRooms as never);
    const oldItem = await mocks.item();
    const item = { ...oldItem, id: "row-bi", itemId: input.backlogItemId, activities,
      ...(mergedFix ? { status: "awaiting-acceptance", type: "product", workType: "bug" } : {}) };
    vi.mocked(db.backlogItem!.findFirst).mockResolvedValue(item);
    if (mergedFix) mocks.completion.mockResolvedValue({ mergedThroughGates: "merged", decision: {
      ...entry.projectBacklogItemReadinessSummary({ item, activities, hasSpec: false, hasPlan: false,
        evaluatedAt: "2026-10-23T00:00:00Z" }).decisions.completion,
      verdict: "allowed", unmet: [], blockers: [],
    } });
    mocks.item.mockResolvedValue(item); mocks.itemFirst.mockResolvedValue(item);
    mocks.activities.mockImplementation(async ({ where }) => typeof where.kind === "string"
      ? activities.filter(activity => activity.kind === where.kind) : activities);
    mocks.rooms.mockImplementation(selectRooms);
    mocks.room.mockResolvedValue(room);
    mocks.readiness.mockImplementation(entry.projectBacklogItemReadinessSummary);
    mocks.design.mockImplementation((args: Parameters<typeof canonical.prepareCurrentDesignObservation>[0]) =>
      canonical.prepareCurrentDesignObservation({ ...args, ports: { readCurrentArtifact: async () => ({ state: "verified", digest: "sha256:new-design" }) } }));
    const discover = async () => ({ resolved: true as const, path: artifact.path, providerBlobId: artifact.providerBlobId });
    const issued = await claimGovernedBacklogWorkspace({ db, input: { ...input, ...source },
      actor: { ...actor, userId: "human", agentId: "AGT-AUTHOR", taskAuthorityTokenId: "access" }, workIntent: mergedFix ? "implementation" : "plan",
      dependencies: { discoverCanonicalArtifact: discover } });
    expect(issued.ok).toBe(false);
    if (issued.ok) throw new Error("The changed design still requires approval");
    const packet = issued.data.recovery.reviewerRoutes.find(route => route.gate === "spec-approval")!.requestCoworker;
    mocks.recovery.mockImplementation((args: Parameters<typeof terminal.resolveTerminalInitiativeRecovery>[0]) =>
      terminal.resolveTerminalInitiativeRecovery({ ...args, ports: { ...terminal.DEFAULT_TERMINAL_RECOVERY_PORTS,
        loadLiveRooms: async ({ refusedWorkroomId }) => refusedWorkroomId
          ? rooms.filter(row => row.capsuleId === refusedWorkroomId) : mergedFix ? [room] : rooms,
        loadBaselinePayloads: async () => activities.filter(activity => activity.kind === "initiative_scope_baseline").map(activity => activity.payload),
        discoverArtifact: async () => ({ resolved: true, artifact: { path: artifact.path, providerBlobId: artifact.providerBlobId } }),
        loadPlanArtifact: async () => ({ resolved: false, nextAction: "Plan coverage is not part of this design review" }),
        resolveRecovery: args => resolveInitiativeReviewerRecovery({ ...args, db: db as never }),
      } }));
    if (mergedFix) {
      const before = await getBacklogItem({ itemId: item.itemId }, "AGT-AUTHOR", "human", context, { currentDesignSource: source });
      expect(before.data?.readiness).toMatchObject({
        planBaselinePrerequisite: { code: "OBJECTIVE_BASELINE_REQUIRED" },
        decisions: { completion: { verdict: "allowed" } },
      });
      const bounded = await getBacklogItem({ itemId: item.itemId, recoveryGate: "spec-approval" },
        "AGT-AUTHOR", "human", context, { currentDesignSource: source });
      expect(bounded.success, JSON.stringify(bounded)).toBe(true);
      expect(packetFrom(bounded)).toEqual(packet);
    }
    const selected = await getBacklogItem({ itemId: item.itemId, workroomId: room.capsuleId,
      recoveryGate: "spec-approval" }, "AGT-AUTHOR", "human", context);
    expect(selected.success, JSON.stringify(selected)).toBe(true);
    expect(packetFrom(selected)).toEqual(packet);
    const authorityResult = await authorizeCoworkerRequest(packet, "human", context);
    expect(authorityResult.refusal, JSON.stringify(authorityResult)).toBeUndefined();
    expect(authorityResult.bounded).toBe(true);
    const unscoped = await getBacklogItem({ itemId: input.backlogItemId, claimSource: source,
      currentDesignSource: source, internal: { currentDesignSource: source } });
    expect(mocks.design).toHaveBeenLastCalledWith({ itemId: input.backlogItemId });
    if (mergedFix) {
      expect(unscoped.data?.readiness).toMatchObject({ decisions: { completion: { verdict: "allowed" } } });
      const retained = readyActivities().find(activity => activity.kind === "initiative_scope_baseline")!;
      activities.push({ ...retained, payload: { ...retained.payload, artifactRef: artifact } });
      const changedHistory = await authorizeCoworkerRequest(packet, "human", context);
      expect(changedHistory.refusal).toBeDefined();
      return;
    }
    expect(unscoped.data?.readiness).toMatchObject({ decisions: { plan: { unmet: expect.arrayContaining([
      expect.objectContaining({ code: "CANONICAL_DESIGN_REQUIRED", state: "missing",
        nextAction: expect.stringContaining("Current immutable design verification is unavailable") }),
    ]) } } });
  });
  it("refuses a selected source that changes during packet issuance", async () => {
    const { issue } = prepare(gates[1]);
    const room = { ...await mocks.room(), capsuleId: "WC-ROUNDTRIP", archivedAt: null, status: "ready" };
    mocks.room.mockResolvedValue(room);
    mocks.recovery.mockImplementation(async ({ taskAuthority }) => {
      const result = await issue(taskAuthority ?? null);
      mocks.room.mockResolvedValue({ ...room, headSha: "f".repeat(40) });
      return result;
    });
    expect(await getBacklogItem({ itemId: "BI-ROUNDTRIP", workroomId: room.capsuleId,
      recoveryGate: "spec-approval" }, "AGT-AUTHOR", "human", context))
      .toMatchObject({ success: false, error: "workroom_source_unavailable" });
  });
  it("ignores caller source hashes when a valid exact locator is supplied", async () => {
    prepare(gates[1]);
    const room = { ...await mocks.room(), capsuleId: "WC-ROUNDTRIP", archivedAt: null, status: "ready" };
    mocks.room.mockResolvedValue(room);
    const result = await getBacklogItem({ itemId: "BI-ROUNDTRIP", workroomId: room.capsuleId,
      recoveryGate: "spec-approval", currentDesignSource: { headSha: "forged" }, claimSource: { headSha: "forged" } },
      "AGT-AUTHOR", "human", context);
    expect(result.success).toBe(true);
    expect(mocks.design).toHaveBeenCalledWith({ itemId: "BI-ROUNDTRIP", claimSource: {
      workroomId: room.capsuleId, repositoryFullName: room.repositoryFullName, headBranch: room.headBranch,
      baseSha: room.baseSha, headSha: room.headSha,
    } });
  });
  it.each(gates)("admits the fresh %s packet exactly as emitted", async (...gate) => {
    prepare(gate);
    const read = await getBacklogItem({ itemId: "BI-ROUNDTRIP", recoveryGate: gate[0], taskAuthorityKey: "client-forgery" }, "AGT-AUTHOR", "human", context);
    expect(read.success, JSON.stringify(read)).toBe(true);
    const packet = packetFrom(read);
    const originalKey = packet.requestKey.replace(/:reviewer:[a-f0-9]{64}$/, "");
    expect(mocks.historyMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      userId: "human", status: { notIn: ["completed", "canceled", "rejected", "archived"] },
      AND: [{ OR: [{ a2aMetadata: { path: ["idempotencyKey"], equals: originalKey } },
        { a2aMetadata: { path: ["idempotencyKey"], string_starts_with: `${originalKey}:reviewer:` } }] },
        { a2aMetadata: { path: ["tokenSource"], equals: "oauth" } }],
    }, take: 501, orderBy: [{ id: "asc" }] }));
    expect(await authorizeCoworkerRequest(packet, "human", context)).toEqual({ bounded: true });
    expect(mocks.authority).toHaveBeenCalledWith({ tokenId: "access", userId: "human", source: "oauth" });
    expect((await authorizeCoworkerRequest({ ...packet, requestKey: `${packet.requestKey}:changed` }, "human", context)).refusal).toBeDefined();
    mocks.authority.mockResolvedValue(null);
    const revoked = await getBacklogItem({ itemId: "BI-ROUNDTRIP", recoveryGate: gate[0] }, "AGT-AUTHOR", "human", context);
    expect(revoked).toMatchObject({ success: false, error: "review_task_authority_unavailable" });
    expect(revoked.data ?? {}).not.toHaveProperty("recovery");
  });

  it.each([false, true])("retains an owned uncertain legacy design task (OAuth metadata: %s)", async (hasOAuthMetadata) => {
    const { issue } = prepare(gates[0]);
    const old = (await issue(null)).reviewerRoutes[0]!.requestCoworker;
    const taskRunId = deterministicExternalTaskRunId(authority.taskAuthorityKey, old.requestKey);
    const authorityScope = ["initiative_evidence_write", "backlog-item:BI-ROUNDTRIP", ...old.requiredToolNames!.map(name => `tool:${name}`)];
    const row = {
      taskRunId, userId: "human", currentAgentId: old.targetAgent, status: "input-required", authorityScope,
      updatedAt: new Date("2026-10-16T00:00:00Z"),
      a2aMetadata: { taskAuthorityKey: authority.taskAuthorityKey, idempotencyKey: old.requestKey, requestedAgentId: old.targetAgent,
        initiativeReviewBinding: old.initiativeReviewBinding,
        ...(hasOAuthMetadata ? { tokenSource: "oauth", apiTokenId: "access", tokenCapability: "write" } : {}),
        requestDigestVersion: 2, requestDigest: remoteTaskRequestDigest({ agentId: old.targetAgent, routeContext: "/build",
          title: old.questionPacketSummary, objective: old.objective, prompt: old.objective, idempotencyKey: old.requestKey,
          riskClass: "bounded-write", authorityScope, collaborationKind: "handoff", initiativeReviewBinding: old.initiativeReviewBinding }) },
      progressPayload: {
        executionUncertainty: { schemaVersion: 1, settlement: "unknown" },
        terminalWriterWait: { schemaVersion: 1, kind: "missing-terminal-writer",
          writerToolName: "record_initiative_design_review", resumeMode: "same-taskrun",
          dispatchContract: "required-tool-call", attempt: 3, observedAt: "2026-10-16T00:00:00Z" },
      },
    };
    mocks.history.mockImplementation(async ({ where }) =>
      where.taskRunId === taskRunId && where.userId === row.userId ? row : null);
    mocks.historyMany.mockImplementation(async ({ where }) => matchesHistoricalReview(row, where) ? [row] : []);
    const read = await getBacklogItem({ itemId: "BI-ROUNDTRIP", recoveryGate: "design-spec" }, "AGT-AUTHOR", "human", context);
    if (hasOAuthMetadata) {
      expect(read).toMatchObject({ success: false, error: "original_review_recovery_required",
        data: { originalResult: { classification: "unknown", replayAllowed: false },
          resultRead: { method: "tasks/result", params: { taskId: taskRunId } } } });
      expect(read.data).not.toHaveProperty("recovery");
      expect(mocks.collect).toHaveBeenCalled();
    } else {
      expect(read.success).toBe(true);
      expect(packetFrom(read)).toEqual(old);
      expect(packetFrom(read)).not.toHaveProperty("reviewRecovery");
      expect(mocks.collect).not.toHaveBeenCalled();
    }
    await expect(mocks.historyMany.mock.results[0]!.value).resolves.toEqual(hasOAuthMetadata ? [row] : []);
    const admission = await authorizeCoworkerRequest(old, "human", context);
    if (hasOAuthMetadata) expect(admission).toMatchObject({ bounded: true,
      refusal: { error: "independent_review_request_denied" } });
    else expect(admission).toEqual({ bounded: true });
  });
});

function packetFrom(result: ToolResult) {
  return (result.data!.recovery as InitiativeReviewerRecovery).reviewerRoutes[0]!.requestCoworker;
}

// Model the query's Boolean predicates instead of assuming every AND child is
// one JSON leaf. Unsupported fixture queries fail rather than hide a saved task.
function matchesHistoricalReview(row: { userId: string; status: string; a2aMetadata: Record<string, unknown> },
  where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "AND" || key === "OR") {
      if (!Array.isArray(value)) throw new Error("Unsupported historical-review Boolean fixture");
      const matches = value.map(clause => matchesHistoricalReview(row, clause));
      return key === "AND" ? matches.every(Boolean) : matches.some(Boolean);
    }
    if (key === "userId") return row.userId === value;
    if (key === "status" && value && typeof value === "object" && "notIn" in value && Array.isArray(value.notIn)) {
      return !value.notIn.includes(row.status);
    }
    if (key === "a2aMetadata" && value && typeof value === "object" && "path" in value
      && Array.isArray(value.path) && value.path.length === 1) {
      const saved = row.a2aMetadata[String(value.path[0])];
      if ("equals" in value) return saved === value.equals;
      if ("string_starts_with" in value && typeof value.string_starts_with === "string") {
        return typeof saved === "string" && saved.startsWith(value.string_starts_with);
      }
    }
    throw new Error(`Unsupported historical-review fixture predicate: ${key}`);
  });
}
