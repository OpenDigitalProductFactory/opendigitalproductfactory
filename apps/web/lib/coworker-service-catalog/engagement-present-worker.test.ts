import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { executeEngagementPresentAttempt } from "./engagement-present-worker";
const db = vi.hoisted(() => ({ transaction: vi.fn(), task: vi.fn() }));
vi.mock("@dpf/db", () => ({ Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } }, prisma: { $transaction: db.transaction, taskRun: { findUnique: db.task, findFirst: (...args: unknown[]) => submission.find(...args) }, agentThread: { upsert: (...args: unknown[]) => submission.thread(...args) } } }));
afterEach(() => vi.unstubAllGlobals());
it("refuses a reconstructed worker packet without reading/mutating the task or reaching any provider", async () => {
  const transport = vi.fn(); vi.stubGlobal("fetch", transport);
  const result = await executeEngagementPresentAttempt({ run: { id: "row", taskRunId: "TR-MCP-present", contextId: "thread" },
    parsed: { engagementBinding: { presentAssessment: { schemaVersion: 1, policyDigest: "a".repeat(64) } } },
    token: { userId: "owner", tokenId: "token", source: "oauth", capability: "write" }, threadId: "thread", userContext: {} } as never, {} as never);
  expect(result).toMatchObject({ kind: "result", result: { taskRunId: "TR-MCP-present", isError: true, resumable: false,
    structuredContent: { error: "engagement-present-live-context-required" } } });
  expect(db.transaction).not.toHaveBeenCalled(); expect(db.task).not.toHaveBeenCalled(); expect(transport).not.toHaveBeenCalled();
});

const submission = vi.hoisted(() => ({ find: vi.fn(), thread: vi.fn(), create: vi.fn(), message: vi.fn(), execute: vi.fn(),
  prepare: vi.fn(), activate: vi.fn(), validate: vi.fn(), enqueue: vi.fn(), projection: vi.fn(), events: [] as string[] }));
vi.mock("./engagement-present-assessment", async load => ({
  ...await load<typeof import("./engagement-present-assessment")>(),
  prepareEngagementPresentAdmission: submission.prepare, activateEngagementPresentAdmission: submission.activate,
}));
vi.mock("./engagement-fulfillment", () => ({ validateEngagementTask: submission.validate, admitEngagementTask: vi.fn() }));
vi.mock("../auth/oauth-task-authority", () => ({ resolveMcpTaskAuthorityKey: async () => "oauth-family:fixture" }));
vi.mock("../tak/autonomous-work-run", () => ({ createAutonomousWorkRun: submission.create, executeAutonomousWorkTool: vi.fn(),
  resolveAutonomousWorkAgent: vi.fn(), resolveAutonomousWorkTools: vi.fn() }));
vi.mock("../tak/task-records", () => ({ createTaskMessage: submission.message }));
vi.mock("../mcp-task-execution", () => ({ executeRemoteTaskAttempt: submission.execute }));
vi.mock("../mcp-task-background-dispatch", () => ({ externalMcpTaskAsyncEnabled: () => true,
  enqueuePersistedRemoteTaskSubmission: submission.enqueue, initialRemoteTaskDispatchProjection: submission.projection }));
import { submitRemoteCoworkerTask } from "../mcp-task-submit";
import { parseRemoteTaskSubmitParams } from "../mcp-task-submit-params";
import { remoteTaskRequestDigest } from "../mcp-task-capacity-contract";
import { presentAssessmentRequestKey } from "./engagement-present-policy";
const originalBinding = { version: 1, engagementId: "CE-1FE20783", offerId: "offer-ux-design-critique", serviceId: "svc-ux-design-critique",
  providerAgentId: "ux-design-critic", actorAgentId: "actor", userId: "owner", workroomId: "WC-9C02621A", stageKey: "accept", inputDigest: "a".repeat(64),
  artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "fixture/repo", commitSha: "b".repeat(40), path: "prototype.html", providerBlobId: "c".repeat(40) },
  visualEvidenceRef: { kind: "document-version", repositoryFullName: "fixture/repo", versionId: "images", valueDigest: "d".repeat(64) } };
const present = { ...originalBinding, presentAssessment: { schemaVersion: 1, policyArtifactId: "ta-engagement-present-policy-" + "e".repeat(64),
  policyDigest: "f".repeat(64), originalTaskRunId: "TR-MCP-original", originalRequestDigest: "1".repeat(64) } };
const params = { agentId: "ux-design-critic", routeContext: "/fixture", title: "Synthetic present Critic", objective: "Original synthetic need",
  prompt: "Synthetic immutable packet", idempotencyKey: presentAssessmentRequestKey("CE-1FE20783"), riskClass: "read",
  authorityScope: ["coworker_engagement_write", "file_read", "registry_read", "tool:read_source_at_version", "tool:wiki_query", "tool:search_ux_critique_corpus"],
  engagementBinding: present };
const parsed = parseRemoteTaskSubmitParams(params);
if (typeof parsed === "string") throw new Error(parsed);
const digest = remoteTaskRequestDigest(parsed);
const hooks = { admissionGuard: vi.fn(), afterTaskCreated: vi.fn() };
const submit = (request: Record<string, unknown> = params) => submitRemoteCoworkerTask({ params: request,
  token: { source: "oauth", capability: "write", userId: "owner", tokenId: "token" }, userContext: { platformRole: "developer", isSuperuser: false } });
beforeEach(() => {
  vi.clearAllMocks(); submission.events.length = 0;
  submission.find.mockResolvedValue(null); submission.thread.mockResolvedValue({ id: "thread" });
  submission.prepare.mockResolvedValue(hooks); submission.validate.mockResolvedValue({});
  submission.create.mockImplementation(async (input: { taskRunId: string }) => {
    submission.events.push("committed"); return { id: "row", taskRunId: input.taskRunId, contextId: "thread" };
  });
  submission.activate.mockImplementation(() => { submission.events.push("activated"); });
  submission.execute.mockImplementation(async () => { submission.events.push("executed"); return { kind: "result", result: { status: "input-required" } }; });
  submission.projection.mockReturnValue({ kind: "fixture-projection" }); submission.enqueue.mockResolvedValue({ status: "submitted" });
});
it("composes actual CE hooks under Serializable, with no projection/deferred input/outbox, then activates only after commit", async () => {
  await submit();
  expect(submission.prepare).toHaveBeenCalledOnce();
  expect(submission.create).toHaveBeenCalledWith(expect.objectContaining({ admissionGuard: hooks.admissionGuard,
    afterTaskCreated: hooks.afterTaskCreated, transactionIsolationLevel: "Serializable" }));
  expect(submission.create.mock.calls[0]![0]).not.toHaveProperty("deferredSubmission");
  expect(submission.projection).not.toHaveBeenCalled(); expect(submission.enqueue).not.toHaveBeenCalled(); expect(submission.message).not.toHaveBeenCalled();
  expect(submission.events).toEqual(["committed", "activated", "executed"]);
});
it("does not activate or execute a candidate whose admission transaction failed", async () => {
  submission.create.mockRejectedValue(new Error("synthetic transaction rollback"));
  await expect(submit()).rejects.toThrow("synthetic transaction rollback");
  expect(submission.activate).not.toHaveBeenCalled(); expect(submission.execute).not.toHaveBeenCalled(); expect(submission.enqueue).not.toHaveBeenCalled();
});
it("returns an existing present allocation without reserve, queue, approval renewal or worker execution", async () => {
  submission.find.mockResolvedValue({ id: "row", taskRunId: "TR-MCP-existing", userId: "owner", status: "submitted", contextId: "thread", threadId: "thread",
    a2aMetadata: { requestDigest: digest, requestDigestVersion: 2 }, progressPayload: {}, updatedAt: new Date(), completedAt: null, lastHeartbeatAt: null });
  expect(await submit()).toMatchObject({ kind: "result", result: { taskRunId: "TR-MCP-existing", resumable: false, requiresApproval: false } });
  expect(submission.prepare).not.toHaveBeenCalled(); expect(submission.create).not.toHaveBeenCalled();
  expect(submission.activate).not.toHaveBeenCalled(); expect(submission.execute).not.toHaveBeenCalled(); expect(submission.enqueue).not.toHaveBeenCalled();
});
it("preserves ordinary engagement asynchronous dispatch and its immutable deferred input", async () => {
  await submit({ ...params, idempotencyKey: "coworker-engagement:CE-1FE20783", engagementBinding: originalBinding });
  expect(submission.prepare).not.toHaveBeenCalled(); expect(submission.projection).toHaveBeenCalledOnce();
  expect(submission.create.mock.calls[0]![0]).toHaveProperty("deferredSubmission");
  expect(submission.enqueue).toHaveBeenCalledOnce(); expect(submission.execute).not.toHaveBeenCalled();
});
