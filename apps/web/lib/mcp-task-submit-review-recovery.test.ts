import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ select: vi.fn(), find: vi.fn(), create: vi.fn(), reserve: vi.fn(), outcome: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { taskRun: { findFirst: mocks.find }, agentThread: { upsert: mocks.create } } }));
vi.mock("./mcp-task-review-recovery", () => ({ loadExplicitReviewRecovery: mocks.select }));
vi.mock("@/lib/auth/oauth-task-authority", () => ({ resolveMcpTaskAuthorityKey: vi.fn(async () => "oauth-family:new") }));
vi.mock("./mcp-task-terminal-writer-recovery", () => ({ reserveTerminalWriterReplay: mocks.reserve, persistedTerminalReaderExecutions: vi.fn() }));
vi.mock("./mcp-task-review-outcome", () => ({ loadTaskInitiativeReviewOutcome: mocks.outcome }));
vi.mock("./mcp-task-submit-approval-recovery", () => ({ resumeApprovedRemoteTask: vi.fn(), recoverStaleApprovalOnReplay: vi.fn() }));
import { submitRemoteCoworkerTask } from "./mcp-task-submit";
import { parseRemoteTaskSubmitParams } from "./mcp-task-submit-params";
import { remoteTaskRequestDigest } from "./mcp-task-capacity-contract";
const request = { agentId: "AGT-WS-EA", routeContext: "/build", title: "Review", objective: "Review", prompt: "Review",
  idempotencyKey: "original", riskClass: "bounded-write", collaborationKind: "handoff",
  authorityScope: ["backlog-item:BI-TEST", "tool:read_source_at_version", "tool:record_initiative_architecture_review"],
  initiativeReviewBinding: { itemId: "BI-TEST", gate: "architecture-review", writerToolName: "record_initiative_architecture_review",
    artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "org/repo", commitSha: "a".repeat(40), path: "docs/design.md", providerBlobId: "b".repeat(40) },
    workroomRef: { kind: "workroom-head", workroomId: "WC-TEST", repositoryFullName: "org/repo", branchName: "fix/test", headSha: "a".repeat(40) } } };
const normalized = parseRemoteTaskSubmitParams(request);
if (typeof normalized === "string") throw Error(normalized);
const digest = remoteTaskRequestDigest(normalized);
const taskRunId = "TR-MCP-original";
const updatedAt = new Date("2026-10-13T18:00:00.053Z");
const params = { ...request, reviewRecovery: { taskRunId, requestDigest: digest, expectedUpdatedAt: updatedAt.toISOString() } };
const row = { id: "original-row", taskRunId, userId: "human", threadId: "thread", contextId: "context", status: "input-required", updatedAt,
  authorityScope: request.authorityScope, a2aMetadata: { requestDigest: digest, requestDigestVersion: 2 },
  progressPayload: { reviewExecutionAuthority: { tokenId: "new-token" }, terminalWriterWait: { schemaVersion: 1,
    kind: "missing-terminal-writer", writerToolName: request.initiativeReviewBinding.writerToolName, resumeMode: "same-taskrun", attempt: 1,
    dispatchContract: "required-tool-call", observedAt: updatedAt.toISOString() } } };
const submit = () => submitRemoteCoworkerTask({ params, token: { tokenId: "new-token", userId: "human", source: "oauth", capability: "write" },
  userContext: { platformRole: "developer", isSuperuser: false } });
beforeEach(() => { vi.resetAllMocks(); mocks.outcome.mockResolvedValue(null); });
it("refuses an explicit invalid target before a new-namespace lookup or task creation", async () => {
  mocks.select.mockResolvedValue({ ok: false, result: { isError: true, structuredContent: { error: "review_recovery_refused" } } });
  expect(await submit()).toMatchObject({ kind: "result", result: { isError: true } });
  expect(mocks.find).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.reserve).not.toHaveBeenCalled();
});
it("reserves the original row with current authority, and a CAS loser reads the actual winner without creating a task", async () => {
  mocks.select.mockResolvedValue({ ok: true, data: { existing: row } });
  mocks.reserve.mockResolvedValue(null);
  mocks.find.mockResolvedValue({ ...row, status: "canceled", progressPayload: { canceledByOwner: true } });
  expect(await submit()).toMatchObject({ kind: "result", result: { taskRunId, status: "canceled" } });
  expect(mocks.reserve).toHaveBeenCalledWith(expect.objectContaining({ existing: row }));
  expect(mocks.find).toHaveBeenCalledWith(expect.objectContaining({ where: { taskRunId, userId: "human" } }));
  expect(mocks.create).not.toHaveBeenCalled();
});
