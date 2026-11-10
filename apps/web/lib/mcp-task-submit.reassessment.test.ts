import { beforeEach, expect, it, vi } from "vitest";
import { submitRemoteCoworkerTask } from "./mcp-task-submit";
import { parseRemoteTaskSubmitParams } from "./mcp-task-submit-params";
import { remoteTaskRequestDigest } from "./mcp-task-capacity-contract";
const mocks = vi.hoisted(() => ({ find: vi.fn(), thread: vi.fn(), create: vi.fn(), message: vi.fn(), execute: vi.fn(),
  prepare: vi.fn(), outcome: vi.fn(), reconcile: vi.fn(), recovery: vi.fn(), enqueue: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { taskRun: { findFirst: mocks.find }, agentThread: { upsert: mocks.thread } } }));
vi.mock("./auth/oauth-task-authority", () => ({ resolveMcpTaskAuthorityKey: vi.fn(async () => "oauth-family:current") }));
vi.mock("./tak/autonomous-work-run", () => ({ createAutonomousWorkRun: mocks.create, executeAutonomousWorkTool: vi.fn(),
  resolveAutonomousWorkAgent: vi.fn(), resolveAutonomousWorkTools: vi.fn() }));
vi.mock("./tak/task-records", () => ({ createTaskMessage: mocks.message }));
vi.mock("./mcp-task-execution", () => ({ executeRemoteTaskAttempt: mocks.execute }));
vi.mock("./mcp-task-reassessment-submission", () => ({ preparePresentReassessmentSubmission: mocks.prepare }));
vi.mock("./mcp-task-review-outcome", () => ({ loadTaskInitiativeReviewOutcome: mocks.outcome, reconcilePersistedReviewStatus: mocks.reconcile }));
vi.mock("./mcp-task-oauth-recovery", () => ({ recoverExpiredOAuthReview: mocks.recovery }));
vi.mock("./mcp-task-background-dispatch", () => ({ externalMcpTaskAsyncEnabled: () => true,
  enqueuePersistedRemoteTaskSubmission: mocks.enqueue, initialRemoteTaskDispatchProjection: vi.fn() }));
const authority = { authorityDecisionId: "allow-request", actingAgentId: "author", tokenGrantScopes: ["backlog_read"] };
const artifact = { kind: "repo-blob-at-commit", repositoryFullName: "org/repo", commitSha: "a".repeat(40), path: "docs/design.md", providerBlobId: "b".repeat(40) };
const params = { agentId: "AGT-WS-REVIEW", routeContext: "/build", title: "Independent review", objective: "Review exact original", prompt: "Review exact original",
  idempotencyKey: "review-reassessment-v1-" + "c".repeat(64), riskClass: "bounded-write", collaborationKind: "handoff",
  authorityScope: ["backlog-item:BI-285EF102", "tool:read_source_at_version", "tool:record_initiative_design_review"],
  initiativeReviewBinding: { itemId: "BI-285EF102", gate: "design-spec", writerToolName: "record_initiative_design_review", artifactRef: artifact,
    workroomRef: { kind: "workroom-head", workroomId: "WC-PARENT", repositoryFullName: "org/repo", branchName: "codex/parent", headSha: "a".repeat(40) },
    presentReassessment: { schemaVersion: 1, authorizationItemId: "BI-7906C73E", baselineId: "baseline-current", policyDigest: "d".repeat(64),
      originalTaskRunId: "TR-MCP-original", originalRequestDigest: "e".repeat(64), predecessorTaskRunIds: ["TR-MCP-original"], authorityArtifact: artifact } } };
const parsed = parseRemoteTaskSubmitParams(params);
if (typeof parsed === "string") throw new Error(parsed);
const requestDigest = remoteTaskRequestDigest(parsed);
const row = { id: "row", taskRunId: "TR-MCP-current", userId: "human", threadId: "thread", contextId: "thread", status: "input-required",
  a2aMetadata: { requestDigest, requestDigestVersion: 2 }, progressPayload: {}, updatedAt: new Date(), lastHeartbeatAt: null, completedAt: null };
const hooks = { admissionGuard: vi.fn(), afterTaskCreated: vi.fn(), requestAuthority: authority };
const submit = (request: Record<string, unknown> = params) => submitRemoteCoworkerTask({ params: request, token: { source: "oauth", capability: "write", userId: "human", tokenId: "token" },
  userContext: { platformRole: "developer", isSuperuser: false }, presentReviewAuthority: authority });
beforeEach(() => {
  vi.resetAllMocks(); mocks.find.mockResolvedValue(null); mocks.thread.mockResolvedValue({ id: "thread" });
  mocks.prepare.mockResolvedValue(hooks); mocks.outcome.mockResolvedValue(null); mocks.reconcile.mockResolvedValue(true);
  mocks.create.mockImplementation(async (input: { taskRunId: string }) => ({ id: "row", taskRunId: input.taskRunId, contextId: "thread" }));
  mocks.execute.mockResolvedValue({ kind: "result", result: { status: "input-required" } });
});
it("persists one atomic root/input and runs inline even with normal async enabled", async () => {
  await submit();
  expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({ parsed, requestAuthority: authority, requestDigest, threadId: "thread" }), expect.any(Object));
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ admissionGuard: hooks.admissionGuard, afterTaskCreated: hooks.afterTaskCreated,
    transactionIsolationLevel: "ReadCommitted", metadata: expect.objectContaining({ presentReviewAuthority: authority }) }));
  expect(mocks.message).not.toHaveBeenCalled(); expect(mocks.enqueue).not.toHaveBeenCalled(); expect(mocks.execute).toHaveBeenCalledOnce();
});
it("refuses static preallocation failure without a TaskRun, input message, or worker", async () => {
  mocks.prepare.mockRejectedValue(new Error("reassessment-native-normal-selection-unsupported"));
  expect(await submit()).toMatchObject({ kind: "result", result: { isError: true, structuredContent: { error: "reassessment-native-normal-selection-unsupported" } } });
  expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.message).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
});
it("replays any existing allocation as readback without ordinary recovery or reopening Q", async () => {
  mocks.find.mockResolvedValue(row);
  expect(await submit()).toMatchObject({ kind: "result", result: { taskRunId: row.taskRunId, resumable: false, requiresApproval: false } });
  expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.recovery).not.toHaveBeenCalled();
});
it("reads a genuine current receipt before any replay or new authority check", async () => {
  mocks.find.mockResolvedValue(row); mocks.outcome.mockResolvedValue({ summary: "Independent pass", receiptId: "receipt" });
  expect(await submit()).toMatchObject({ kind: "result", result: { status: "completed", structuredContent: { receiptId: "receipt" } } });
  expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
});
it("joins the authorized same-owner existing assessment across families without starting it again", async () => {
  mocks.create.mockRejectedValue(Object.assign(new Error("reassessment-existing-assessment"), { code: "reassessment-existing-assessment", taskRunId: row.taskRunId, requestDigest }));
  mocks.find.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(row);
  expect(await submit()).toMatchObject({ kind: "result", result: { taskRunId: row.taskRunId, resumable: false } });
  expect(mocks.find).toHaveBeenLastCalledWith(expect.objectContaining({ where: { taskRunId: row.taskRunId, userId: "human" } }));
  expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.message).not.toHaveBeenCalled();
});
it("never exposes another owner's allocation when the lineage join cannot be read", async () => {
  mocks.create.mockRejectedValue(Object.assign(new Error("reassessment-existing-assessment"), { code: "reassessment-existing-assessment", taskRunId: "TR-other-owner", requestDigest }));
  const result = await submit();
  expect(result).toMatchObject({ kind: "result", result: { isError: true, structuredContent: { error: "reassessment-existing-assessment-access-required" } } });
  expect(JSON.stringify(result)).not.toContain("TR-other-owner"); expect(mocks.execute).not.toHaveBeenCalled();
});
it("reconciles saved readback scope across connection families without accepting wider tool boundaries", async () => {
  mocks.create.mockRejectedValue(Object.assign(new Error("reassessment-existing-assessment"), { code: "reassessment-existing-assessment", taskRunId: row.taskRunId, requestDigest }));
  mocks.find.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce({ ...row, authorityScope: params.authorityScope });
  expect(await submit({ ...params, authorityScope: [...params.authorityScope, "new-ordinary-grant"] }))
    .toMatchObject({ kind: "result", result: { taskRunId: row.taskRunId, resumable: false } });
  expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.message).not.toHaveBeenCalled();
});
it("refuses a changed packet on existing present readback without suggesting another key", async () => {
  mocks.find.mockResolvedValue(row);
  const result = await submit({ ...params, prompt: "Different assessment" });
  expect(result).toMatchObject({ kind: "result", result: { isError: true, structuredContent: { error: "reassessment-packet-changed" } } });
  expect(JSON.stringify(result)).not.toContain("new requestKey"); expect(mocks.execute).not.toHaveBeenCalled();
});
it("holds an original quarantined assessment before ordinary connection recovery", async () => {
  const { presentReassessment: _relation, ...binding } = params.initiativeReviewBinding;
  const ordinary = { ...params, initiativeReviewBinding: binding };
  const original = parseRemoteTaskSubmitParams(ordinary);
  if (typeof original === "string") throw new Error(original);
  mocks.find.mockResolvedValue({ ...row, progressPayload: { reassessmentQuarantine: { replayAllowed: false } },
    a2aMetadata: { requestDigest: remoteTaskRequestDigest(original), requestDigestVersion: 2 } });
  mocks.recovery.mockResolvedValue(true);
  expect(await submit(ordinary)).toMatchObject({ kind: "result", result: { resumable: false, requiresApproval: false } });
  expect(mocks.recovery).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
});
it("reads an existing same-owner allocation across families before any fresh execution preflight", async () => {
  mocks.find.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...row, authorityScope: params.authorityScope });
  mocks.prepare.mockRejectedValue(new Error("reassessment-native-normal-selection-unsupported"));
  expect(await submit({ ...params, authorityScope: [...params.authorityScope, "additive-current-grant"] }))
    .toMatchObject({ kind: "result", result: { taskRunId: row.taskRunId, resumable: false } });
  expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
});
it("reads the actual cross-family task when cancellation wins receipt reconciliation", async () => {
  mocks.find.mockResolvedValueOnce(null).mockResolvedValueOnce(row).mockResolvedValueOnce({ ...row, status: "canceled" });
  mocks.outcome.mockResolvedValue({ summary: "Independent pass", receiptId: "receipt" }); mocks.reconcile.mockResolvedValue(false);
  expect(await submit()).toMatchObject({ kind: "result", result: { taskRunId: row.taskRunId, status: "canceled" } });
  expect(mocks.find).toHaveBeenLastCalledWith(expect.objectContaining({ where: { taskRunId: row.taskRunId, userId: "human" } }));
  expect(mocks.execute).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
});
it("retries only a rolled-back lineage race with fresh locks and no worker effects", async () => {
  mocks.create.mockRejectedValueOnce(Object.assign(new Error("reassessment-lineage-restart"), { code: "reassessment-lineage-restart" }))
    .mockResolvedValueOnce({ id: "row", taskRunId: "TR-created", contextId: "thread" });
  await submit(); expect(mocks.create).toHaveBeenCalledTimes(2); expect(mocks.execute).toHaveBeenCalledOnce(); expect(mocks.prepare).toHaveBeenCalledOnce();
});
