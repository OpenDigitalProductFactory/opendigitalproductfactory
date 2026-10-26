import { compactEngagementRead } from "./engagement-read-provenance";
import { describe, expect, it, vi } from "vitest";
import { parseEngagementTaskBinding, engagementInputDigest, assertEngagementSnapshot, engagementToolAllowed, validateEngagementContribution, validateEngagementTask, admitEngagementTask, engagementProviderIdentityRefs, reconcileEngagementTaskResult } from "./engagement-fulfillment";
import { fulfillCoworkerEngagement } from "@/lib/mcp/external-coworker-task-adapter";
import { parseRemoteTaskSubmitParams } from "@/lib/mcp-task-submit-params";
import { remoteTaskRequestDigest } from "@/lib/mcp-task-capacity-contract";
const admission = vi.hoisted(() => ({ allowed: true }));
vi.mock("@/lib/work-management/workroom-agent-access.server", () => ({ resolveAgentWorkroomAccess: async ({ requested }: { requested: string }) => ({ decision: { level: admission.allowed ? requested : "none", reason: "not-admitted" } }) }));

const artifactRef = { kind: "repo-blob-at-commit", repositoryFullName: "owner/repo", commitSha: "a".repeat(40), path: "docs/design.md", providerBlobId: "b".repeat(40) } as const;
const binding = { version: 1, engagementId: "CE-1", offerId: "offer-1", serviceId: "service-1", providerAgentId: "ux-critic", actorAgentId: "coding-agent", userId: "user-1", workroomId: "WC-1", stageKey: "design", inputDigest: engagementInputDigest("Review design", { artifactRef }), artifactRef } as const;
const readEvidence = () => [
  compactEngagementRead("read-1", "read_source_at_version", { repositoryFullName: artifactRef.repositoryFullName, version: artifactRef.commitSha, path: artifactRef.path, expectedBlobId: artifactRef.providerBlobId }, { success: true, message: "read", data: { repositoryFullName: artifactRef.repositoryFullName, version: artifactRef.commitSha, path: artifactRef.path, blobId: artifactRef.providerBlobId, content: "Prototype", startLine: 1, endLine: 1, totalLines: 1, hasMore: false, nextCursor: null } })!,
  compactEngagementRead("wiki-1", "wiki_query", {}, { success: true, message: "read", data: { results: [{ slug: "professions/ux-design/hierarchy", contentPreview: "Relevant surface detail" }] } })!,
  compactEngagementRead("critique-1", "search_ux_critique_corpus", { calibratedOnly: true }, { success: true, message: "none", data: { total: 0, grounding: "UNGROUNDED" } })!,
];
const snapshot = () => ({
  engagement: { engagementId: "CE-1", offerId: "offer-1", serviceId: "service-1", providerAgentId: "ux-critic", requestedByUserId: "user-1", requestedByAgentId: "coding-agent", requestedOutcome: "Review design", inputPayload: { artifactRef }, status: "requested", approvalContext: { required: false }, metadata: {} },
  offer: { offerId: "offer-1", serviceId: "service-1", status: "active", authorityBoundary: "advice-only", riskTier: "low", availabilityScope: "internal", budgetEnvelope: {}, requiredApprovals: [], expiresAt: null },
  service: { serviceId: "service-1", providerAgentId: "ux-critic", status: "active", authorityBoundary: "advice-only", riskTier: "low", availabilityScope: "internal" },
  room: { capsuleId: "WC-1", taskRunId: "run-1", headSha: artifactRef.commitSha, repositoryFullName: "owner/repo", archivedAt: null, workspaceState: { workroomDrive: { stageKey: "design" } } },
});

describe("bounded advisory engagement fulfillment", () => {
  it("does not disclose another room's completed contribution to a room-scoped credential", async () => {
    const engagement = { ...snapshot().engagement, status: "completed", metadata: { fulfillment: { binding, taskRunId: "TR-ORIGINAL" }, result: { summary: "Private room result" } } };
    const credential = { kind: "workroom_session", userId: "user-1", workroomRef: "WC-FOREIGN", runRef: "run-1", revokedAt: null, expiresAt: null };
    const fakeDb = { coworkerEngagement: { findFirst: async () => engagement, findUnique: async () => engagement }, mcpApiToken: { findUnique: async () => credential }, taskRun: { findUnique: async () => null }, workroom: { findUnique: async () => ({ ...snapshot().room, id: "room-row-1" }) } };
    const context = { agentId: binding.actorAgentId, apiTokenId: "token-1", authSource: "pat", userContext: { userId: "user-1", isSuperuser: false, platformRole: "developer" } };
    await expect(fulfillCoworkerEngagement(binding.engagementId, undefined, binding.userId, context as never, fakeDb as never)).rejects.toThrow(/read_scope_refused/);
  });
  it("a lost-response retry observes its existing task without submitting again", async () => {
    const currentBinding = { ...binding, roomHeadSha: artifactRef.commitSha };
    const engagement = { ...snapshot().engagement, status: "completed", metadata: { fulfillment: { binding: currentBinding, taskRunId: "TR-ORIGINAL" }, result: { summary: "Actual persisted result" } } };
    const fakeDb = { $queryRaw: vi.fn().mockResolvedValue([]), coworkerEngagement: { findFirst: async () => engagement, findUnique: async () => engagement },
      mcpApiToken: { findUnique: async () => ({ userId: binding.userId, kind: "operator", revokedAt: null, expiresAt: null }) },
      workroom: { findUnique: async () => ({ ...snapshot().room, id: "room-row-1" }) }, taskRun: { findUnique: async () => null } };
    const context = { agentId: binding.actorAgentId, apiTokenId: "token-1", authSource: "pat", tokenScope: "write", userContext: { userId: binding.userId } };
    const result = await fulfillCoworkerEngagement(binding.engagementId, { workroomId: binding.workroomId, stageKey: binding.stageKey, artifactRef }, binding.userId, context as never, fakeDb as never);
    expect(result).toMatchObject({ success: true, data: { status: "completed", fulfillment: { taskRunId: "TR-ORIGINAL" }, result: { summary: "Actual persisted result" } } });
  });
  it("uses the registered canonical/runtime provider pair and no unrelated aliases", () => {
    expect(engagementProviderIdentityRefs("AGT-906")).toEqual(["AGT-906", "ux-design-critic"]);
    expect(engagementProviderIdentityRefs("ux-design-critic")).toEqual(["AGT-906", "ux-design-critic"]);
    expect(engagementProviderIdentityRefs("AGT-906")).not.toContain("ux-accessibility");
  });
  it("reprojects an unknown original task only from its actual persisted state and evidence", async () => {
    const result = { summary: "Use compact rows", criteria: ["Surface detail"], corpusRefs: ["professions/ux-design/hierarchy"], findings: [] };
    const task = { status: "input-required", progressPayload: { executionUncertainty: { outcome: "unknown" }, summary: JSON.stringify(result) }, a2aMetadata: { engagementBinding: binding, engagementReadEvidence: readEvidence() }, completedAt: null };
    const engagement = { ...snapshot().engagement, id: "row-1", status: "unknown", updatedAt: new Date(), metadata: { fulfillment: { taskRunId: "TR-ORIGINAL", binding } } };
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const returned = vi.fn().mockResolvedValue({ id: "return-1" });
    const fakeDb = {
      $queryRaw: vi.fn().mockResolvedValue([]), workroomActivity: { create: returned },
      taskRun: { findUnique: async () => task }, coworkerEngagement: { findUnique: async () => engagement, updateMany },
      workroom: { findUnique: async () => ({ ...snapshot().room, id: "room-row-1" }) },
      agent: { findUnique: async () => ({ agentId: "ux-design-critic", name: "ux-design-critic", slugId: "ux-design-critic" }) },
      toolExecution: { findMany: async () => [
        { id: "read-1", toolName: "read_source_at_version", success: true, parameters: { repositoryFullName: "owner/repo", version: artifactRef.commitSha, path: artifactRef.path, expectedBlobId: artifactRef.providerBlobId }, result: {} },
        { id: "wiki-1", toolName: "wiki_query", success: true, parameters: {}, result: { data: { results: [{ slug: "professions/ux-design/hierarchy" }] } } },
        { id: "critique-1", toolName: "search_ux_critique_corpus", success: true, parameters: { calibratedOnly: true }, result: { data: { grounding: "UNGROUNDED", total: 0 } } },
      ] },
    };
    await reconcileEngagementTaskResult("TR-ORIGINAL", fakeDb as never);
    expect(updateMany).not.toHaveBeenCalled();
    task.status = "completed";
    task.progressPayload = { summary: JSON.stringify(result) } as typeof task.progressPayload;
    await reconcileEngagementTaskResult("TR-ORIGINAL", fakeDb as never);
    expect(returned).toHaveBeenCalledOnce();
    engagement.status = "completed";
    await reconcileEngagementTaskResult("TR-ORIGINAL", fakeDb as never);
    expect(returned).toHaveBeenCalledOnce();
    expect(updateMany.mock.calls[0]![0].data).toMatchObject({ status: "completed", metadata: { result: { advisoryOnly: true, authorDisposition: "pending", sourceExecutionIds: ["read-1"] } } });
  });
  function authorityDb() {
    const state = snapshot();
    const grants = ["coworker_engagement_write", "file_read", "registry_read"];
    const actor = { agentId: String(binding.actorAgentId), status: "active", archived: false, lifecycleStage: "production", toolGrants: grants.map(grantKey => ({ grantKey })), toolGrantRevocations: [] as { grantKey: string }[] };
    const provider = { ...actor, agentId: String(binding.providerAgentId) };
    const credential = { kind: "operator", userId: String(binding.userId), agentId: binding.actorAgentId, capability: "write", revokedAt: null as Date | null, expiresAt: null, scopes: grants, workroomRef: null as string | null, runRef: null as string | null };
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    return { actor, provider, credential, state, updateMany, db: {
      mcpApiToken: { findUnique: async () => credential }, agent: { findFirst: async () => actor, findUnique: async (_args: unknown) => provider },
      coworkerEngagement: { findUnique: async () => ({ ...state.engagement, id: "row-1", updatedAt: new Date(), offer: state.offer, service: state.service }), updateMany },
      workroom: { findUnique: async () => ({ ...state.room, id: "room-row-1" }) },
    } };
  }
  const execution = { binding, token: { tokenId: "token-1", userId: binding.userId, capability: "write" as const, source: "pat" as const }, taskRunId: "TR-ORIGINAL", authorityScope: ["coworker_engagement_write", "file_read", "registry_read", "tool:read_source_at_version", "tool:wiki_query", "tool:search_ux_critique_corpus"] };
  it("includes immutable engagement identity in the durable request digest and refuses wider submission modes", () => {
    const packet = { agentId: binding.providerAgentId, routeContext: "/area/platform", objective: "Review", prompt: "Review", idempotencyKey: "coworker-engagement:CE-1", riskClass: "read", authorityScope: execution.authorityScope, engagementBinding: binding };
    const parsed = parseRemoteTaskSubmitParams(packet);
    expect(typeof parsed).not.toBe("string");
    if (typeof parsed === "string") throw new Error(parsed);
    expect(parsed.engagementBinding).toEqual(binding);
    expect(remoteTaskRequestDigest(parsed)).not.toBe(remoteTaskRequestDigest({ ...parsed, engagementBinding: { ...binding, stageKey: "other" } }));
    for (const change of [{ riskClass: "bounded-write" }, { threadId: "foreign" }, { agentId: "foreign" }, { idempotencyKey: "new-key" }, { authorityScope: [...execution.authorityScope, "tool:execute_script"] }]) {
      expect(typeof parseRemoteTaskSubmitParams({ ...packet, ...change })).toBe("string");
    }
  });
  it("checks live authority before atomically associating the original request", async () => {
    admission.allowed = true;
    const fake = authorityDb();
    await admitEngagementTask({ ...execution, db: fake.db as never });
    expect(fake.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "accepted", workCapsuleId: "WC-1", metadata: { fulfillment: expect.objectContaining({ taskRunId: "TR-ORIGINAL", binding }) } }) }));
  });
  it("refuses a direct task submission that substitutes the engagement objective or prompt", async () => {
    const fake = authorityDb();
    await expect(validateEngagementTask({ ...execution, db: fake.db as never, request: { objective: "Different objective", prompt: "Different instructions" } } as never)).rejects.toThrow(/request_content_refused/);
  });
  it("keeps the original actor while resolving its canonical grants and revocations", async () => {
    const fake = authorityDb();
    const canonical = { ...fake.actor, agentId: "AGT-EXT-CODEX" };
    fake.actor.agentId = "external-codex";
    fake.actor.toolGrants = [];
    Object.assign(fake.credential, { agentId: "external-codex" });
    Object.assign(fake.state.engagement, { requestedByAgentId: "external-codex" });
    const currentBinding = { ...binding, actorAgentId: "external-codex" };
    fake.db.agent.findUnique = async (args) => (args as { where: { agentId: string } }).where.agentId === "AGT-EXT-CODEX" ? canonical : fake.provider;
    const result = await validateEngagementTask({ ...execution, binding: currentBinding, db: fake.db as never });
    expect(result.engagement.requestedByAgentId).toBe("external-codex");
    canonical.toolGrantRevocations = [{ grantKey: "coworker_engagement_write" }];
    fake.actor.toolGrants = [{ grantKey: "coworker_engagement_write" }, { grantKey: "file_read" }, { grantKey: "registry_read" }];
    await expect(admitEngagementTask({ ...execution, binding: currentBinding, db: fake.db as never })).rejects.toThrow(/grant_intersection_refused/);
    expect(fake.updateMany).not.toHaveBeenCalled();
  });
  it("reads grants only from the current canonical authority owner, never an empty or permissive alias", async () => {
    const fake = authorityDb();
    const currentBinding = { ...binding, providerAgentId: "AGT-906" };
    // Isolate authority ownership: this fixture's canonical provider is qualified.
    // The live UX critic still lacks file_read; this fixture does not grant it.
    const canonical = { ...fake.provider, agentId: "AGT-906" };
    const runtime = { ...fake.provider, agentId: "ux-design-critic", toolGrants: [] as Array<{ grantKey: string }> };
    Object.assign(fake.state.engagement, { providerAgentId: "AGT-906" });
    Object.assign(fake.state.service, { providerAgentId: "AGT-906" });
    fake.db.agent.findUnique = async (args) => (args as { where: { agentId: string } }).where.agentId === "AGT-906" ? canonical : runtime;
    await expect(validateEngagementTask({ ...execution, binding: currentBinding, db: fake.db as never })).resolves.toHaveProperty("room");
    canonical.toolGrantRevocations = [{ grantKey: "file_read" }];
    runtime.toolGrants = [{ grantKey: "file_read" }, { grantKey: "registry_read" }];
    await expect(validateEngagementTask({ ...execution, binding: currentBinding, db: fake.db as never })).rejects.toThrow(/grant_intersection_refused/);
  });
  it("admits a canonical provider with its current runtime pair and refuses canonical revocation or inactive identities", async () => {
    const fake = authorityDb();
    const canonicalBinding = { ...binding, providerAgentId: "AGT-906" };
    const canonical = { ...fake.provider, agentId: "AGT-906" };
    const runtime = { ...fake.provider, agentId: "ux-design-critic" };
    Object.assign(fake.state.engagement, { providerAgentId: "AGT-906" });
    Object.assign(fake.state.service, { providerAgentId: "AGT-906" });
    fake.db.agent.findUnique = async (args) => (args as { where: { agentId: string } }).where.agentId === "AGT-906" ? canonical : runtime;
    await expect(validateEngagementTask({ ...execution, binding: canonicalBinding, db: fake.db as never })).resolves.toHaveProperty("room");
    canonical.toolGrantRevocations = [{ grantKey: "registry_read" }];
    await expect(validateEngagementTask({ ...execution, binding: canonicalBinding, db: fake.db as never })).rejects.toThrow(/grant_intersection_refused/);
    canonical.toolGrantRevocations = [];
    runtime.archived = true;
    await expect(validateEngagementTask({ ...execution, binding: canonicalBinding, db: fake.db as never })).rejects.toThrow(/identity_pair_unavailable/);
    runtime.archived = false;
    canonical.archived = true;
    await expect(validateEngagementTask({ ...execution, binding: canonicalBinding, db: fake.db as never })).rejects.toThrow(/principal_or_scope_unavailable/);
  });
  it("refuses revoked, foreign, narrowed, or unadmitted authority without associating work", async () => {
    admission.allowed = true;
    for (const mutate of [
      (fake: ReturnType<typeof authorityDb>) => { fake.credential.revokedAt = new Date(); },
      (fake: ReturnType<typeof authorityDb>) => { fake.credential.userId = "foreign"; },
      (fake: ReturnType<typeof authorityDb>) => { fake.actor.agentId = "foreign"; },
      (fake: ReturnType<typeof authorityDb>) => { fake.actor.toolGrantRevocations = [{ grantKey: "coworker_engagement_write" }]; },
      (fake: ReturnType<typeof authorityDb>) => { fake.provider.archived = true; },
      (fake: ReturnType<typeof authorityDb>) => { fake.credential.scopes = []; },
    ]) {
      const fake = authorityDb(); mutate(fake);
      await expect(admitEngagementTask({ ...execution, db: fake.db as never })).rejects.toThrow();
      expect(fake.updateMany).not.toHaveBeenCalled();
    }
    admission.allowed = false;
    const fake = authorityDb();
    await expect(validateEngagementTask({ ...execution, db: fake.db as never })).rejects.toThrow(/room_access_refused/);
    admission.allowed = true;
  });
  it("refuses a lost execution association and a concurrent acceptance", async () => {
    const fake = authorityDb();
    await expect(validateEngagementTask({ ...execution, db: fake.db as never, requireAssociation: true })).rejects.toThrow(/association_missing/);
    fake.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(admitEngagementTask({ ...execution, db: fake.db as never })).rejects.toThrow(/race_retry_original/);
  });
  it("keeps a room-session credential inside its original room and run", async () => {
    const fake = authorityDb();
    fake.credential.kind = "workroom_session";
    fake.credential.workroomRef = "WC-FOREIGN";
    fake.credential.runRef = "run-1";
    Object.assign(fake.state.room.workspaceState.workroomDrive, { runKey: "delivery-cycle-is-not-the-session-task" });
    await expect(validateEngagementTask({ ...execution, db: fake.db as never })).rejects.toThrow(/credential_scope_refused/);
    fake.credential.workroomRef = binding.workroomId;
    fake.credential.runRef = "old-run";
    await expect(validateEngagementTask({ ...execution, db: fake.db as never })).rejects.toThrow(/credential_scope_refused/);
    fake.credential.runRef = "run-1";
    await expect(validateEngagementTask({ ...execution, db: fake.db as never })).resolves.toHaveProperty("room");
  });
  it("requires actual source and cited corpus executions before accepting a contribution", () => {
    const content = JSON.stringify({ summary: "Use compact rows", criteria: ["Relevant surface detail"], corpusRefs: ["professions/ux-design/hierarchy"], findings: [] });
    const executions = [
      { id: "read-1", toolName: "read_source_at_version", success: true, parameters: { repositoryFullName: "owner/repo", version: artifactRef.commitSha, path: artifactRef.path, expectedBlobId: artifactRef.providerBlobId }, result: {} },
      { id: "wiki-1", toolName: "wiki_query", success: true, parameters: {}, result: { data: { results: [{ slug: "professions/ux-design/hierarchy" }] } } },
    ];
    expect(validateEngagementContribution(binding, content, executions)).toBeNull(); // metrics-only audits cannot prove a read
    expect(validateEngagementContribution(binding, content, executions, undefined, readEvidence())).toMatchObject({ summary: "Use compact rows", sourceExecutionIds: ["read-1"], corpusExecutionIds: ["wiki-1"] });
    expect(validateEngagementContribution(binding, content, [])).toBeNull();
    expect(validateEngagementContribution(binding, content, executions.map(row => ({ ...row, success: false })))).toBeNull();
    expect(validateEngagementContribution(binding, content.replace("professions/ux-design/hierarchy", "invented-page"), executions)).toBeNull();
    expect(validateEngagementContribution(binding, "Task completed", executions)).toBeNull();
  });
  it("preserves a free-text original revision while room head is newer", () => {
    const state = snapshot();
    state.engagement.inputPayload = { "surface-or-prototype": "owner/repo@" + artifactRef.commitSha + " docs/design.md" } as never;
    state.room.headSha = "c".repeat(40);
    const original = { ...binding, roomHeadSha: state.room.headSha, inputDigest: engagementInputDigest(state.engagement.requestedOutcome, state.engagement.inputPayload) };
    expect(() => assertEngagementSnapshot(original, state)).not.toThrow();
    expect(() => assertEngagementSnapshot({ ...original, artifactRef: { ...artifactRef, path: "docs/other.md" } }, state)).toThrow(/original_artifact/);
    expect(() => assertEngagementSnapshot({ ...original, artifactRef: { ...artifactRef, commitSha: state.room.headSha } }, state)).toThrow(/original_revision_required/);
  });
  it("validates an immutable bound request", () => {
    expect(parseEngagementTaskBinding(binding)).toEqual(binding);
    expect(() => assertEngagementSnapshot({ ...binding, artifactRef: { ...artifactRef, providerBlobId: "c".repeat(40) } }, snapshot())).toThrow(/original_artifact/);
    expect(() => assertEngagementSnapshot(binding, snapshot())).not.toThrow();
  });
  it.each([
    { actorAgentId: "foreign" }, { userId: "foreign" }, { providerAgentId: "foreign" },
    { offerId: "foreign" }, { serviceId: "foreign" }, { workroomId: "foreign" },
    { stageKey: "other" }, { inputDigest: "f".repeat(64) },
  ])("refuses changed principal or scope %j", (change) => {
    expect(() => assertEngagementSnapshot({ ...binding, ...change }, snapshot())).toThrow();
  });
  it.each(["needs-approval", "cancelled", "completed", "rejected"])("does not execute %s engagements", (status) => {
    const state = snapshot(); state.engagement.status = status;
    expect(() => assertEngagementSnapshot(binding, state)).toThrow();
  });
  it("refuses approval requirements, paid providers, and inactive offers", () => {
    for (const change of [{ authorityBoundary: "never-allowed" }, { authorityBoundary: "approval-required" }, { status: "retired" }, { riskTier: "critical" }, { availabilityScope: "external" }, { budgetEnvelope: { paidProvider: true } }, { requiredApprovals: ["owner"] }]) {
      const state = snapshot(); Object.assign(state.offer, change);
      expect(() => assertEngagementSnapshot(binding, state)).toThrow();
    }
  });
  it("refuses a stale artifact, changed inputs, and forged server execution association", () => {
    const stale = snapshot(); stale.room.headSha = "c".repeat(40);
    expect(() => assertEngagementSnapshot(binding, stale)).toThrow();
    const changed = snapshot(); changed.engagement.requestedOutcome = "Different work";
    expect(() => assertEngagementSnapshot(binding, changed)).toThrow();
    const forged = snapshot(); forged.engagement.metadata = { fulfillment: { taskRunId: "foreign" } };
    expect(() => assertEngagementSnapshot(binding, forged)).toThrow();
  });
  it("allows only the immutable artifact reader and corpus lookup; deferred loading cannot widen scope", () => {
    expect(engagementToolAllowed(binding, "read_source_at_version", { repositoryFullName: "owner/repo", version: artifactRef.commitSha, path: artifactRef.path, expectedBlobId: artifactRef.providerBlobId })).toBe(true);
    expect(engagementToolAllowed(binding, "wiki_query", { query: "UX hierarchy" })).toBe(true);
    for (const tool of ["load_tools", "request_coworker", "record_initiative_ux_review", "read_source_file", "execute_script"]) {
      expect(engagementToolAllowed(binding, tool, {})).toBe(false);
    }
    expect(engagementToolAllowed(binding, "read_source_at_version", { version: "HEAD", path: artifactRef.path })).toBe(false);
  });
  it.each([{ version: 2 }, { artifactRef: { ...artifactRef, commitSha: "HEAD" } }, { inputDigest: "invalid" }, { extraAuthority: true }])("rejects malformed or widened task bindings %j", (change) => {
    expect(parseEngagementTaskBinding({ ...binding, ...change })).toBeNull();
  });
});


it("does not treat an uncalibrated UX search as calibration evidence", () => {
  const contribution = JSON.stringify({ summary: "Compact rows", criteria: ["Pertinent detail"], corpusRefs: ["professions/ux-design/hierarchy"], findings: [] });
  const executions = [
    { id: "read-1", toolName: "read_source_at_version", success: true, parameters: { repositoryFullName: artifactRef.repositoryFullName, version: artifactRef.commitSha, path: artifactRef.path, expectedBlobId: artifactRef.providerBlobId }, result: {} },
    { id: "wiki-1", toolName: "wiki_query", success: true, parameters: {}, result: { data: { results: [{ slug: "professions/ux-design/hierarchy" }] } } },
    { id: "critique-1", toolName: "search_ux_critique_corpus", success: true, parameters: { calibratedOnly: false }, result: { data: { total: 1, grounding: "grounded" } } },
  ];
  expect(validateEngagementContribution(binding, contribution, executions, "ux-design")).toBeNull();
});

it("rolls back completion when the Workroom return fails, then safely retries once", async () => {
  const task = { status: "completed", progressPayload: { summary: JSON.stringify({ summary: "Critique", criteria: ["Hierarchy"], corpusRefs: ["professions/ux-design/hierarchy"], findings: [] }) }, a2aMetadata: { engagementBinding: binding, engagementReadEvidence: readEvidence() }, completedAt: new Date() };
  let engagement = { ...snapshot().engagement, id: "row-1", status: "accepted", updatedAt: new Date(), metadata: { fulfillment: { taskRunId: "TR-ORIGINAL", binding } } };
  let returnWrites = 0; let failReturn = true;
  const tx = { $queryRaw: async () => [], taskRun: { findUnique: async () => task }, agent: { findUnique: async () => ({ agentId: "ux-design-critic", name: "ux-design-critic", slugId: "ux-design-critic" }) },
    coworkerEngagement: { findUnique: async () => engagement, updateMany: async ({ data }: { data: object }) => { engagement = { ...engagement, ...data }; return { count: 1 }; } },
    workroom: { findUnique: async () => ({ id: "room-1" }) }, workroomActivity: { create: async () => { if (failReturn) throw new Error("return unavailable"); returnWrites++; return { id: "return-1" }; } },
    toolExecution: { findMany: async () => readEvidence().map(row => ({ id: row.executionId, success: true, toolName: row.kind === "source" ? "read_source_at_version" : row.kind === "corpus" ? "wiki_query" : "search_ux_critique_corpus", parameters: {}, result: {} })) } };
  const database = { $transaction: async (work: (db: typeof tx) => Promise<void>) => { const prior = engagement; try { return await work(tx); } catch (error) { engagement = prior; throw error; } } };
  await expect(reconcileEngagementTaskResult("TR-ORIGINAL", database as never)).rejects.toThrow("return unavailable");
  expect(engagement.status).toBe("accepted");
  failReturn = false;
  await reconcileEngagementTaskResult("TR-ORIGINAL", database as never);
  await reconcileEngagementTaskResult("TR-ORIGINAL", database as never);
  expect(engagement.status).toBe("completed");
  expect(returnWrites).toBe(1);
});

it("reports a projection interruption as actionable observation failure without execution", async () => {
  const engagement = { ...snapshot().engagement, status: "accepted", metadata: { fulfillment: { taskRunId: "TR-ORIGINAL", binding } } };
  const fake = { $queryRaw: vi.fn().mockRejectedValue(new Error("transaction expired")), coworkerEngagement: { findFirst: async () => engagement },
    mcpApiToken: { findUnique: async () => ({ kind: "operator", userId: binding.userId, revokedAt: null, expiresAt: null }) },
    workroom: { findUnique: async () => ({ id: "room", capsuleId: binding.workroomId }) } };
  const result = await fulfillCoworkerEngagement(binding.engagementId, undefined, binding.userId, { agentId: binding.actorAgentId, apiTokenId: "current", authSource: "pat", tokenScope: "write", userContext: { userId: binding.userId } } as never, fake as never);
  expect(result).toMatchObject({ success: false, error: "engagement_projection_unavailable", data: { taskRunId: "TR-ORIGINAL", executionRequested: false } });
});
