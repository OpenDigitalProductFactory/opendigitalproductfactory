import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  item: vi.fn(), readiness: vi.fn(), recovery: vi.fn(), history: vi.fn(), historyMany: vi.fn(), authority: vi.fn(),
  access: vi.fn(), design: vi.fn(), itemFirst: vi.fn(), activities: vi.fn(), rooms: vi.fn(), room: vi.fn(),
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
vi.mock("@/lib/backlog/initiative-readiness/backlog-completion-evaluation", () => ({ readBacklogItemCompletion: async () => null }));
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
  mocks.itemFirst.mockReset().mockResolvedValue(null);
  mocks.activities.mockReset().mockResolvedValue([]);
  mocks.rooms.mockReset().mockResolvedValue([]);
  mocks.room.mockReset().mockResolvedValue({ id: "room-row", backlogItemId: "BI-ROUNDTRIP", executorKind: "codex-desktop",
    repositoryFullName: "org/repo", headBranch: "feat/roundtrip", baseSha: "e".repeat(40), headSha: "a".repeat(40) });
  mocks.design.mockReset().mockResolvedValue({ evidence: { state: "not-applicable" } });
  mocks.history.mockResolvedValue(null);
  mocks.historyMany.mockResolvedValue([]);
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
  it("admits the actual scoped claim packet with real readiness and multiple persisted rooms", async () => {
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
    const activities = readyActivities().map(activity => activity.kind === "initiative_scope_baseline"
      ? { ...activity, payload: { ...activity.payload, artifactRef: artifact } } : activity);
    const room = { ...source, id: "room-row", capsuleId: "WC-ENTRY", backlogItemId: input.backlogItemId,
      executorKind: "codex-desktop", archivedAt: null, status: "ready", isLive: true };
    const rooms = [room, { ...room, capsuleId: "WC-OTHER", headBranch: "feat/other" }];
    const selectRooms = async (query: unknown) => {
      const { where } = query as { where: Record<string, unknown> };
      return rooms.filter(row => ["repositoryFullName", "headBranch", "baseSha", "headSha"].every(key =>
        where[key] === undefined || where[key] === row[key as keyof typeof row]));
    };
    const db = database(activities);
    Object.assign(db, { $queryRaw: vi.fn().mockResolvedValue([]) });
    vi.mocked(db.workroom.findMany).mockImplementation(selectRooms as never);
    const oldItem = await mocks.item();
    const item = { ...oldItem, id: "row-bi", itemId: input.backlogItemId, activities };
    mocks.item.mockResolvedValue(item); mocks.itemFirst.mockResolvedValue(item);
    mocks.activities.mockResolvedValue(activities); mocks.rooms.mockImplementation(selectRooms);
    mocks.room.mockResolvedValue(room);
    mocks.readiness.mockImplementation(entry.projectBacklogItemReadinessSummary);
    mocks.design.mockImplementation((args: Parameters<typeof canonical.prepareCurrentDesignObservation>[0]) =>
      canonical.prepareCurrentDesignObservation({ ...args, ports: { readCurrentArtifact: async () => ({ state: "verified", digest: "sha256:new-design" }) } }));
    const discover = async () => ({ resolved: true as const, path: artifact.path, providerBlobId: artifact.providerBlobId });
    const issued = await claimGovernedBacklogWorkspace({ db, input: { ...input, ...source },
      actor: { ...actor, userId: "human", agentId: "AGT-AUTHOR", taskAuthorityTokenId: "access" }, workIntent: "plan",
      dependencies: { discoverCanonicalArtifact: discover } });
    expect(issued.ok).toBe(false);
    if (issued.ok) throw new Error("The changed design still requires approval");
    const packet = issued.data.recovery.reviewerRoutes.find(route => route.gate === "spec-approval")!.requestCoworker;
    mocks.recovery.mockImplementation((args: Parameters<typeof terminal.resolveTerminalInitiativeRecovery>[0]) =>
      terminal.resolveTerminalInitiativeRecovery({ ...args, ports: { ...terminal.DEFAULT_TERMINAL_RECOVERY_PORTS,
        loadLiveRooms: async ({ refusedWorkroomId }) => rooms.filter(row => row.capsuleId === refusedWorkroomId),
        loadBaselinePayloads: async () => [activities[0]!.payload],
        discoverArtifact: async () => ({ resolved: true, artifact: { path: artifact.path, providerBlobId: artifact.providerBlobId } }),
        loadPlanArtifact: async () => ({ resolved: false, nextAction: "Plan coverage is not part of this design review" }),
        resolveRecovery: args => resolveInitiativeReviewerRecovery({ ...args, db: db as never }),
      } }));
    const authorityResult = await authorizeCoworkerRequest(packet, "human", context);
    expect(authorityResult.refusal, JSON.stringify(authorityResult)).toBeUndefined();
    expect(authorityResult.bounded).toBe(true);
    const unscoped = await getBacklogItem({ itemId: input.backlogItemId, claimSource: source,
      currentDesignSource: source, internal: { currentDesignSource: source } });
    expect(mocks.design).toHaveBeenLastCalledWith({ itemId: input.backlogItemId });
    expect(unscoped.data?.readiness).toMatchObject({ decisions: { plan: { unmet: expect.arrayContaining([
      expect.objectContaining({ code: "CANONICAL_DESIGN_REQUIRED", state: "missing",
        nextAction: expect.stringContaining("Current immutable design verification is unavailable") }),
    ]) } } });
  });
  it.each(gates)("admits the fresh %s packet exactly as emitted", async (...gate) => {
    prepare(gate);
    const read = await getBacklogItem({ itemId: "BI-ROUNDTRIP", recoveryGate: gate[0], taskAuthorityKey: "client-forgery" }, "AGT-AUTHOR", "human", context);
    expect(read.success, JSON.stringify(read)).toBe(true);
    const packet = packetFrom(read);
    expect(mocks.historyMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      userId: "human", status: { notIn: ["completed", "canceled", "rejected", "archived"] },
      AND: [{ a2aMetadata: { path: ["idempotencyKey"], equals: packet.requestKey } },
        { a2aMetadata: { path: ["tokenSource"], equals: "oauth" } }],
    } }));
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
      a2aMetadata: { taskAuthorityKey: authority.taskAuthorityKey, idempotencyKey: old.requestKey, requestedAgentId: old.targetAgent,
        ...(hasOAuthMetadata ? { tokenSource: "oauth", apiTokenId: "access" } : {}),
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
    mocks.historyMany.mockImplementation(async ({ where }) => {
      const key = where.AND.find((entry: { a2aMetadata: { path: string[] } }) =>
        entry.a2aMetadata.path[0] === "idempotencyKey")?.a2aMetadata.equals;
      const source = where.AND.find((entry: { a2aMetadata: { path: string[] } }) =>
        entry.a2aMetadata.path[0] === "tokenSource")?.a2aMetadata.equals;
      return where.userId === row.userId && !where.status.notIn.includes(row.status)
        && key === row.a2aMetadata.idempotencyKey && source === row.a2aMetadata.tokenSource ? [row] : [];
    });
    const read = await getBacklogItem({ itemId: "BI-ROUNDTRIP", recoveryGate: "design-spec" }, "AGT-AUTHOR", "human", context);
    expect(read.success).toBe(true);
    expect(packetFrom(read)).toEqual(old);
    await expect(mocks.historyMany.mock.results[0]!.value).resolves.toEqual(hasOAuthMetadata ? [row] : []);
    expect(packetFrom(read)).not.toHaveProperty("reviewRecovery");
    expect(await authorizeCoworkerRequest(old, "human", context)).toEqual({ bounded: true });
  });
});

function packetFrom(result: ToolResult) {
  return (result.data!.recovery as InitiativeReviewerRecovery).reviewerRoutes[0]!.requestCoworker;
}
