import { beforeEach, describe, expect, it, vi } from "vitest";
const runtime = vi.hoisted(() => ({ db: {} as Record<string, unknown>, load: vi.fn(), validate: vi.fn(), namespace: vi.fn(), send: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: runtime.db }));
vi.mock("@/lib/mcp-task-persisted-request", async original => ({ ...await original<typeof import("@/lib/mcp-task-persisted-request")>(), loadPersistedRemoteTask: runtime.load }));
vi.mock("@/lib/auth/oauth-task-authority", () => ({ resolveMcpTaskAuthorityKey: runtime.namespace }));
vi.mock("./engagement-fulfillment", () => ({ validateEngagementTask: runtime.validate }));
vi.mock("@/lib/queue/mcp-task-run-events", () => ({ sendMcpTaskRunExecutionEvent: runtime.send }));
import { parseRemoteTaskSubmitParams } from "@/lib/mcp-task-submit-params";
import { remoteTaskRequestDigest, deterministicExternalTaskRunId } from "@/lib/mcp-task-capacity-contract";
import { planEngagementDigestContinuation, resumeUnstartedEngagementTask } from "./engagement-pre-admission-recovery";
import { parseEngagementTaskBinding } from "./engagement-task-binding";
function fixture() {
  const binding = parseEngagementTaskBinding({ version: 1, engagementId: "CE-ORIGINAL", offerId: "offer", serviceId: "service", providerAgentId: "ux-design-critic", actorAgentId: "AGT-EXT-CODEX", userId: "user", workroomId: "WC-ORIGINAL", stageKey: "accept", artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "owner/repo", commitSha: "a".repeat(40), path: "docs/prototype.html", providerBlobId: "b".repeat(40) }, inputDigest: "c".repeat(64) })!;
  const key = "coworker-engagement:CE-ORIGINAL";
  const parsed = parseRemoteTaskSubmitParams({ agentId: binding.providerAgentId, routeContext: "/area/platform", title: "Critique", objective: "Review", prompt: "Original full request", riskClass: "read", idempotencyKey: key, engagementBinding: binding, authorityScope: ["file_read", "registry_read", "coworker_engagement_write", "tool:read_source_at_version", "tool:wiki_query", "tool:search_ux_critique_corpus"] });
  if (typeof parsed === "string") throw new Error(parsed);
  const taskRunId = deterministicExternalTaskRunId("oauth-family:family", key);
  const task = { id: "row", taskRunId, userId: "user", threadId: "thread", contextId: "thread", status: "failed", updatedAt: new Date("2026-10-25T19:42:18Z"), completedAt: new Date("2026-10-25T19:42:18Z"), lastHeartbeatAt: null, routeContext: parsed.routeContext, title: parsed.title, objective: parsed.objective, currentAgentId: parsed.agentId, authorityScope: parsed.authorityScope!,
    a2aMetadata: { trigger: "external-mcp", tokenSource: "oauth", tokenCapability: "write", apiTokenId: "origin-token", taskAuthorityKey: "oauth-family:family", requestDigest: remoteTaskRequestDigest(parsed), requestDigestVersion: 2, requestObjective: parsed.objective, requestedAgentId: parsed.agentId, requestedThreadId: null, idempotencyKey: key, riskClass: "read", engagementBinding: binding },
    progressPayload: { error: "Persisted remote task request does not match its immutable digest.", errorCode: "request_digest_mismatch", dispatch: { schemaVersion: 1, kind: "external-mcp-task", state: "enqueued", attempt: 1, eventId: `mcp-task-run:${taskRunId}:execute:1`, requestedAt: "2026-10-25T19:42:17Z", enqueuedAt: "2026-10-25T19:42:17Z" } }, messages: [{ parts: [{ type: "message", text: parsed.prompt }] }], user: { id: "user", isActive: true, isSuperuser: false, groups: [{ platformRole: { roleId: "developer" } }] } };
  return { task, binding };
}
describe("original engagement pre-admission continuation", () => {
  it("preserves the original task, digest, failure and origin while planning only dispatch 2", () => {
    const { task, binding } = fixture();
    const plan = planEngagementDigestContinuation(task, binding);
    expect(plan).not.toBeNull();
    expect(plan?.progress.dispatch).toMatchObject({ attempt: 2, state: "pending", eventId: `mcp-task-run:${task.taskRunId}:execute:2` });
    expect(plan?.progress.engagementPreAdmissionContinuation).toMatchObject({ schemaVersion: 1, normalizationVersion: 1, requestDigest: task.a2aMetadata.requestDigest, originTokenId: "origin-token", priorProgress: task.progressPayload });
  });
  it.each([
    { status: "working" }, { status: "input-required" }, { lastHeartbeatAt: new Date() }, { completedAt: null },
    { progressPayload: { errorCode: "provider-outcome-uncertain" } },
  ])("refuses started, uncertain and unproven states %j", change => {
    const { task, binding } = fixture();
    expect(planEngagementDigestContinuation({ ...task, ...change }, binding)).toBeNull();
  });
  it.each(["claimedAt", "resumeReservedAt", "executionUncertainty", "engagementPreAdmissionContinuation", "reviewExecutionAuthority"])("refuses any prior generation or extra progress marker %s", key => {
    const { task, binding } = fixture();
    expect(planEngagementDigestContinuation({ ...task, progressPayload: { ...task.progressPayload, [key]: "observed" } }, binding)).toBeNull();
  });
  it("refuses changed prompts, revisions, task identity and claimed dispatches", () => {
    const { task, binding } = fixture();
    for (const change of [ { messages: [{ parts: [{ text: "Changed" }] }] }, { taskRunId: "another-task" }, { a2aMetadata: { ...task.a2aMetadata, engagementBinding: { ...binding, stageKey: "other" } } }, { progressPayload: { ...task.progressPayload, dispatch: { ...task.progressPayload.dispatch, state: "claimed", claimedAt: "now" } } } ]) expect(planEngagementDigestContinuation({ ...task, ...change }, binding)).toBeNull();
  });
});

describe("continuation authority, effects and atomic reservation", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  function setup() {
    const { task, binding } = fixture();
    let current = { ...task };
    const effectCounts = [0, 0, 0, 0, 0, 0];
    const engagement = { id: "ce-row", status: "failed", updatedAt: task.updatedAt, metadata: { fulfillment: { taskRunId: task.taskRunId, binding } } };
    runtime.load.mockImplementation(async () => ({ ...current }));
    runtime.namespace.mockResolvedValue("oauth-family:family");
    runtime.validate.mockResolvedValue({ engagement });
    runtime.send.mockResolvedValue(undefined);
    const updateMany = vi.fn(async ({ where, data }) => {
      if (current.status !== where.status || current.updatedAt !== where.updatedAt) return { count: 0 };
      current = { ...current, ...data, updatedAt: new Date() };
      return { count: 1 };
    });
    const project = vi.fn(async () => ({ count: 1 }));
    let transactionTail = Promise.resolve();
    const tx = { $queryRaw: async () => [], taskRun: { updateMany }, coworkerEngagement: { updateMany: project },
      ...Object.fromEntries(["toolExecution", "asyncInferenceOp", "coworkerActionEnvelope", "taskNode", "taskArtifact", "taskMessage"].map((key, index) => [key, { count: async () => effectCounts[index] }])) };
    Object.assign(runtime.db, { taskRun: { findUnique: async () => ({ updatedAt: current.updatedAt, completedAt: current.completedAt, lastHeartbeatAt: current.lastHeartbeatAt }) },
      $transaction: async (work: (db: typeof tx) => Promise<boolean>) => {
        const previous = transactionTail; let release!: () => void;
        transactionTail = new Promise(resolve => { release = resolve; });
        await previous; const prior = current;
        try { return await work(tx); } catch (error) { current = prior; throw error; } finally { release(); }
      },
    });
    return { task, binding, effectCounts, updateMany, project, current: () => current,
      input: { taskRunId: task.taskRunId, binding, token: { tokenId: "current-token", userId: task.userId, source: "oauth" as const, capability: "write" as const } } };
  }
  it("reserves exactly one concurrent continuation and sends the same task once", async () => {
    const f = setup();
    const outcomes = await Promise.all([resumeUnstartedEngagementTask(f.input), resumeUnstartedEngagementTask(f.input)]);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    expect(runtime.send).toHaveBeenCalledExactlyOnceWith(f.task.taskRunId, `mcp-task-run:${f.task.taskRunId}:execute:2`);
    expect(f.project).toHaveBeenCalledTimes(1);
    expect(runtime.validate.mock.calls.map(([arg]) => arg.token.tokenId)).toContain("origin-token");
    expect(runtime.validate.mock.calls.map(([arg]) => arg.token.tokenId)).toContain("current-token");
    expect(await resumeUnstartedEngagementTask(f.input)).toBe(false);
    expect(runtime.send).toHaveBeenCalledTimes(1);
  });
  it.each([0, 1, 2, 3, 4, 5])("refuses recorded effects category %i without a reservation", async index => {
    const f = setup(); f.effectCounts[index] = 1;
    await expect(resumeUnstartedEngagementTask(f.input)).rejects.toThrow(/execution_evidence_present/);
    expect(f.updateMany).not.toHaveBeenCalled(); expect(runtime.send).not.toHaveBeenCalled();
  });
  it("refuses another current consent family and revoked current authority", async () => {
    const f = setup(); runtime.namespace.mockResolvedValueOnce("oauth-family:other");
    await expect(resumeUnstartedEngagementTask(f.input)).rejects.toThrow(/current_original_family_required/);
    runtime.namespace.mockResolvedValue("oauth-family:family"); runtime.validate.mockRejectedValueOnce(new Error("revoked"));
    await expect(resumeUnstartedEngagementTask(f.input)).rejects.toThrow("revoked");
    expect(f.updateMany).not.toHaveBeenCalled(); expect(runtime.send).not.toHaveBeenCalled();
  });
  it("rolls back the task continuation if its original engagement projection races", async () => {
    const f = setup(); f.project.mockResolvedValueOnce({ count: 0 });
    await expect(resumeUnstartedEngagementTask(f.input)).rejects.toThrow(/projection_raced/);
    expect(f.current().status).toBe("failed"); expect(runtime.send).not.toHaveBeenCalled();
  });
  it("retains the durable outbox if sending fails, without reserving another continuation", async () => {
    const f = setup(); runtime.send.mockRejectedValueOnce(new Error("queue unavailable"));
    expect(await resumeUnstartedEngagementTask(f.input)).toBe(true);
    expect(f.current().status).toBe("submitted");
    expect(await resumeUnstartedEngagementTask(f.input)).toBe(false);
    expect(runtime.send).toHaveBeenCalledTimes(1);
  });
});
