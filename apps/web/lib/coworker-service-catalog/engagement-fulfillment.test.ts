import { describe, expect, it, vi } from "vitest";
import { parseEngagementTaskBinding, engagementInputDigest, assertEngagementSnapshot, engagementToolAllowed, validateEngagementContribution, validateEngagementTask, admitEngagementTask } from "./engagement-fulfillment";
import { parseRemoteTaskSubmitParams } from "@/lib/mcp-task-submit-params";
import { remoteTaskRequestDigest } from "@/lib/mcp-task-capacity-contract";
const admission = vi.hoisted(() => ({ allowed: true }));
vi.mock("@/lib/work-management/workroom-agent-access.server", () => ({ resolveAgentWorkroomAccess: async ({ requested }: { requested: string }) => ({ decision: { level: admission.allowed ? requested : "none", reason: "not-admitted" } }) }));

const artifactRef = { kind: "repo-blob-at-commit", repositoryFullName: "owner/repo", commitSha: "a".repeat(40), path: "docs/design.md", providerBlobId: "b".repeat(40) } as const;
const binding = { version: 1, engagementId: "CE-1", offerId: "offer-1", serviceId: "service-1", providerAgentId: "ux-critic", actorAgentId: "coding-agent", userId: "user-1", workroomId: "WC-1", stageKey: "design", inputDigest: engagementInputDigest("Review design", { artifactRef }), artifactRef } as const;
const snapshot = () => ({
  engagement: { engagementId: "CE-1", offerId: "offer-1", serviceId: "service-1", providerAgentId: "ux-critic", requestedByUserId: "user-1", requestedByAgentId: "coding-agent", requestedOutcome: "Review design", inputPayload: { artifactRef }, status: "requested", approvalContext: { required: false }, metadata: {} },
  offer: { offerId: "offer-1", serviceId: "service-1", status: "active", authorityBoundary: "advice-only", riskTier: "low", availabilityScope: "internal", budgetEnvelope: {}, requiredApprovals: [], expiresAt: null },
  service: { serviceId: "service-1", providerAgentId: "ux-critic", status: "active", authorityBoundary: "advice-only", riskTier: "low", availabilityScope: "internal" },
  room: { capsuleId: "WC-1", headSha: artifactRef.commitSha, repositoryFullName: "owner/repo", archivedAt: null, workspaceState: { workroomDrive: { stageKey: "design" } } },
});

describe("bounded advisory engagement fulfillment", () => {
  function authorityDb() {
    const state = snapshot();
    const grants = ["coworker_engagement_write", "file_read", "registry_read"];
    const actor = { agentId: String(binding.actorAgentId), status: "active", archived: false, toolGrants: grants.map(grantKey => ({ grantKey })), toolGrantRevocations: [] as { grantKey: string }[] };
    const provider = { ...actor, agentId: binding.providerAgentId };
    const credential = { kind: "operator", userId: String(binding.userId), agentId: binding.actorAgentId, capability: "write", revokedAt: null as Date | null, expiresAt: null, scopes: grants };
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    return { actor, provider, credential, state, updateMany, db: {
      mcpApiToken: { findUnique: async () => credential }, agent: { findFirst: async () => actor, findUnique: async () => provider },
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
  it("requires actual source and cited corpus executions before accepting a contribution", () => {
    const content = JSON.stringify({ summary: "Use compact rows", criteria: ["Relevant surface detail"], corpusRefs: ["professions/ux-design/hierarchy"], findings: [] });
    const executions = [
      { id: "read-1", toolName: "read_source_at_version", success: true, parameters: { repositoryFullName: "owner/repo", version: artifactRef.commitSha, path: artifactRef.path, expectedBlobId: artifactRef.providerBlobId }, result: {} },
      { id: "wiki-1", toolName: "wiki_query", success: true, parameters: {}, result: { data: { results: [{ slug: "professions/ux-design/hierarchy" }] } } },
    ];
    expect(validateEngagementContribution(binding, content, executions)).toMatchObject({ summary: "Use compact rows", sourceExecutionIds: ["read-1"], corpusExecutionIds: ["wiki-1"] });
    expect(validateEngagementContribution(binding, content, [])).toBeNull();
    expect(validateEngagementContribution(binding, content, executions.map(row => ({ ...row, success: false })))).toBeNull();
    expect(validateEngagementContribution(binding, content.replace("professions/ux-design/hierarchy", "invented-page"), executions)).toBeNull();
    expect(validateEngagementContribution(binding, "Task completed", executions)).toBeNull();
  });
  it("validates an immutable bound request", () => {
    expect(parseEngagementTaskBinding(binding)).toEqual(binding);
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
