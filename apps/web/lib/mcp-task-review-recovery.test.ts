import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ liveTask: vi.fn(), cas: vi.fn(), reads: vi.fn(), writer: vi.fn(), tasks: vi.fn(), task: vi.fn(), token: vi.fn(), current: vi.fn(), authorize: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { taskRun: { findFirst: mocks.task, findUnique: mocks.liveTask, findMany: mocks.tasks, updateMany: mocks.cas }, toolExecution: { findMany: mocks.reads, findFirst: mocks.writer }, mcpApiToken: { findUnique: mocks.token } } }));
vi.mock("./auth/oauth-tokens", () => ({ OAUTH_EXECUTION_AUTHORITY_SELECT: {}, isCurrentOAuthExecutionAuthority: mocks.current }));
vi.mock("./mcp/independent-review-request", () => ({ authorizeCoworkerRequest: mocks.authorize }));
import { loadExplicitReviewRecovery } from "./mcp-task-review-recovery";
import { deterministicExternalTaskRunId, remoteTaskRequestDigest } from "./mcp-task-capacity-contract";
import { parseRemoteTaskSubmitParams } from "./mcp-task-submit-params";

const scope = ["file_read", "backlog-item:BI-TEST", "tool:read_source_at_version", "tool:record_initiative_architecture_review"];
const raw = { agentId: "AGT-WS-EA", routeContext: "/build", title: "Review", objective: "Review", prompt: "Review",
  idempotencyKey: "review-original", riskClass: "bounded-write", collaborationKind: "handoff", authorityScope: scope,
  initiativeReviewBinding: { itemId: "BI-TEST", gate: "architecture-review", writerToolName: "record_initiative_architecture_review",
    artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "org/repo", commitSha: "a".repeat(40), path: "docs/design.md", providerBlobId: "b".repeat(40) },
    workroomRef: { kind: "workroom-head", workroomId: "WC-TEST", repositoryFullName: "org/repo", branchName: "fix/test", headSha: "a".repeat(40) } } };
const normalized = parseRemoteTaskSubmitParams(raw);
if (typeof normalized === "string") throw Error(normalized);
const digest = remoteTaskRequestDigest(normalized);
const taskRunId = deterministicExternalTaskRunId("oauth-family:original", raw.idempotencyKey);
const updatedAt = new Date("2026-10-13T18:00:00.053Z");
const row = { id: "row-original", taskRunId, userId: "human", threadId: "thread-original", contextId: "context-original",
  status: "input-required", updatedAt, lastHeartbeatAt: null, completedAt: null, authorityScope: scope,
  a2aMetadata: { apiTokenId: "old-token", tokenSource: "oauth", tokenCapability: "write", taskAuthorityKey: "oauth-family:original", idempotencyKey: raw.idempotencyKey,
    requestedAgentId: raw.agentId, requestDigestVersion: 2, requestDigest: digest },
  progressPayload: { terminalWriterWait: { schemaVersion: 1, kind: "missing-terminal-writer", resumeMode: "same-taskrun",
    writerToolName: raw.initiativeReviewBinding.writerToolName, dispatchContract: "required-tool-call", attempt: 1, observedAt: updatedAt.toISOString() } } };
const token = { tokenId: "new-token", userId: "human", source: "oauth" as const, capability: "write" as const };
const params = { ...normalized, reviewRecovery: { taskRunId, requestDigest: digest, expectedUpdatedAt: updatedAt.toISOString() } };
const current = { userId: "human", agentId: "AGT-EXT-CODEX", capability: "write", authorityBindingId: "new-binding", scopes: ["file_read"], oauthClient: { registrationKind: "dcr" } };

beforeEach(() => {
  vi.resetAllMocks(); mocks.task.mockResolvedValue(structuredClone(row));
  mocks.token.mockImplementation(async ({ where }: { where: { id: string } }) => where.id === "new-token" ? current : { userId: "human", agentId: "AGT-EXT-CODEX" });
  mocks.current.mockResolvedValue(true); mocks.authorize.mockResolvedValue({ bounded: true });
});

it("selects the original paused task under current authority without rewriting its immutable origin", async () => {
  const result = await loadExplicitReviewRecovery({ token, parsed: params, userContext: { platformRole: "developer", isSuperuser: false } });
  expect(result.ok ? null : result.result.structuredContent.reason).toBeNull();
  expect(result).toMatchObject({ ok: true, data: { existing: { taskRunId, a2aMetadata: { apiTokenId: "old-token", taskAuthorityKey: "oauth-family:original" },
    progressPayload: { reviewExecutionAuthority: { tokenId: "new-token", requestDigest: digest } } } } });
  expect(row.progressPayload).not.toHaveProperty("reviewExecutionAuthority");
  expect(mocks.authorize).toHaveBeenCalled();
});

it.each(["canceled", "completed", "working", "submitted"])("refuses %s before another dispatch", async status => {
  mocks.task.mockResolvedValue({ ...row, status });
  expect(await loadExplicitReviewRecovery({ token, parsed: params, userContext: { platformRole: "developer", isSuperuser: false } })).toMatchObject({ ok: false });
});

it("refuses revoked current authority and credentials-client substitution", async () => {
  mocks.current.mockResolvedValue(false);
  expect(await loadExplicitReviewRecovery({ token, parsed: params, userContext: { platformRole: "developer", isSuperuser: false } })).toMatchObject({ ok: false });
  mocks.current.mockResolvedValue(true); mocks.token.mockResolvedValue({ ...current, oauthClient: { registrationKind: "credentials" } });
  expect(await loadExplicitReviewRecovery({ token, parsed: params, userContext: { platformRole: "developer", isSuperuser: false } })).toMatchObject({ ok: false });
});

it("refuses changed owner, actor, request or checkpoint and uncertain execution", async () => {
  for (const change of [ { userId: "other" }, { updatedAt: new Date() },
    { a2aMetadata: { ...row.a2aMetadata, requestDigest: "d".repeat(64) } },
    { progressPayload: { ...row.progressPayload, executionUncertainty: { kind: "execution-uncertain", settlement: "unknown", schemaVersion: 1 } } } ]) {
    mocks.task.mockResolvedValue({ ...row, ...change });
    expect(await loadExplicitReviewRecovery({ token, parsed: params, userContext: { platformRole: "developer", isSuperuser: false } })).toMatchObject({ ok: false });
  }
  mocks.task.mockResolvedValue(row);
  mocks.token.mockImplementation(async ({ where }: { where: { id: string } }) => where.id === "new-token" ? current : { userId: "human", agentId: "other-agent" });
  expect(await loadExplicitReviewRecovery({ token, parsed: params, userContext: { platformRole: "developer", isSuperuser: false } })).toMatchObject({ ok: false });
});

it("issues a locator for the exact saved request and refuses ambiguous or uncertain prior executions", async () => {
  const { issueOriginalReviewRecoveryTarget } = await import("./mcp-task-review-recovery");
  const packet = { targetAgent: raw.agentId, objective: raw.objective, questionPacketSummary: raw.title,
    requestKey: raw.idempotencyKey, tier: 2, enteredVia: "handoff", requiredToolNames: scope.filter(s => s.startsWith("tool:")).map(s => s.slice(5)),
    initiativeReviewBinding: raw.initiativeReviewBinding };
  mocks.tasks.mockResolvedValue([structuredClone(row)]);
  expect(await issueOriginalReviewRecoveryTarget({ packet, userId: "human", actingAgentId: "AGT-EXT-CODEX", taskAuthorityKey: "oauth-family:new" }))
    .toEqual({ kind: "target", target: params.reviewRecovery });
  expect(await issueOriginalReviewRecoveryTarget({ packet, userId: "human", actingAgentId: "AGT-EXT-CODEX", taskAuthorityKey: "oauth-family:original" }))
    .toEqual({ kind: "none" });
  mocks.tasks.mockResolvedValue([row, row]);
  expect(await issueOriginalReviewRecoveryTarget({ packet, userId: "human", actingAgentId: "AGT-EXT-CODEX", taskAuthorityKey: "oauth-family:new" })).toMatchObject({ kind: "refused" });
  mocks.tasks.mockResolvedValue([{ ...row, progressPayload: { executionUncertainty: {} } }]);
  expect(await issueOriginalReviewRecoveryTarget({ packet, userId: "human", actingAgentId: "AGT-EXT-CODEX", taskAuthorityKey: "oauth-family:new" })).toMatchObject({ kind: "refused" });
});

it.each(["scope", "deadline", "retry-budget", "room-or-lane", "unknown-settlement", "widened-tool", "changed-source"])("refuses %s without rewriting the original checkpoint", async condition => {
  const original = structuredClone(row);
  let request = structuredClone(params);
  if (condition === "scope") mocks.token.mockImplementation(async ({ where }) => where.id === "new-token" ? { ...current, scopes: [] } : { userId: "human", agentId: current.agentId });
  if (condition === "deadline") original.progressPayload = { ...original.progressPayload, deadlineAt: new Date(Date.now() - 60_000).toISOString() } as never;
  if (condition === "retry-budget") original.progressPayload.terminalWriterWait.attempt = 3;
  if (condition === "room-or-lane") mocks.authorize.mockResolvedValue({ bounded: true, refusal: { success: false } });
  if (condition === "unknown-settlement") delete (original.progressPayload.terminalWriterWait as Record<string, unknown>).dispatchContract;
  if (condition === "widened-tool") request.authorityScope = [...scope, "tool:deploy"];
  if (condition === "changed-source") request.initiativeReviewBinding!.artifactRef = { ...request.initiativeReviewBinding!.artifactRef, commitSha: "d".repeat(40) } as never;
  mocks.task.mockResolvedValue(original);
  expect(await loadExplicitReviewRecovery({ token, parsed: request, userContext: { platformRole: "developer", isSuperuser: false } })).toMatchObject({ ok: false });
  expect(original.progressPayload).not.toHaveProperty("reviewExecutionAuthority");
});

it("rechecks live authority and immutable budgets after restart instead of trusting the transfer record", async () => {
  const { revalidateReviewExecutionAuthority } = await import("./mcp-task-review-recovery");
  const selected = await loadExplicitReviewRecovery({ token, parsed: params, userContext: { platformRole: "developer", isSuperuser: false } });
  if (!selected.ok) throw Error(JSON.stringify(selected));
  const input = { token, parsed: params, userContext: { platformRole: "developer", isSuperuser: false },
    metadata: selected.data.existing.a2aMetadata, progress: selected.data.existing.progressPayload };
  expect(await revalidateReviewExecutionAuthority(input)).toBe(true);
  mocks.current.mockResolvedValue(false);
  expect(await revalidateReviewExecutionAuthority(input)).toBe(false);
  mocks.current.mockResolvedValue(true); mocks.authorize.mockResolvedValue({ bounded: true, refusal: { success: false } });
  expect(await revalidateReviewExecutionAuthority(input)).toBe(false);
  mocks.authorize.mockResolvedValue({ bounded: true });
  expect(await revalidateReviewExecutionAuthority({ ...input, progress: { ...(input.progress as object), expiresAt: new Date(Date.now() - 60_000).toISOString() } })).toBe(false);
  expect(await revalidateReviewExecutionAuthority({ ...input, token: { ...token, tokenId: "other-token" } })).toBe(false);
});

it("two recoveries persist authority and reserve the original generation in one CAS; only one can dispatch", async () => {
  const { reserveTerminalWriterReplay } = await import("./mcp-task-terminal-writer-recovery");
  const { createInitiativeReviewTerminalToolPolicy } = await import("./tak/terminal-tool-policy");
  const selected = await loadExplicitReviewRecovery({ token, parsed: params, userContext: { platformRole: "developer", isSuperuser: false } });
  if (!selected.ok) throw Error(JSON.stringify(selected));
  mocks.reads.mockResolvedValue([]); mocks.writer.mockResolvedValue(null);
  let status = "input-required";
  mocks.cas.mockImplementation(async ({ where, data }) => {
    if (where.status !== status || where.updatedAt.getTime() !== updatedAt.getTime()) return { count: 0 };
    status = data.status;
    return { count: 1 };
  });
  const policy = createInitiativeReviewTerminalToolPolicy(raw.initiativeReviewBinding.writerToolName,
    scope.filter(s => s.startsWith("tool:")).map(s => s.slice(5)), params.initiativeReviewBinding!.artifactRef);
  if (!policy) throw Error("Expected a bound terminal writer policy");
  const results = await Promise.all([1, 2].map(() => reserveTerminalWriterReplay({ existing: selected.data.existing, parsed: params, terminalToolPolicy: policy })));
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(status).toBe("working");
  expect(mocks.cas).toHaveBeenCalledWith(expect.objectContaining({ where: { taskRunId, status: "input-required", updatedAt },
    data: expect.objectContaining({ progressPayload: expect.objectContaining({ reviewExecutionAuthority: expect.objectContaining({ tokenId: "new-token", originTokenId: "old-token" }) }) }) }));
  for (const [call] of mocks.cas.mock.calls) expect(call.data).not.toHaveProperty("a2aMetadata");
});

it("rechecks a recovered task's live permission at each governed effect and holds unavailable checks", async () => {
  const { reviewRecoveryToolRefusal } = await import("./mcp-task-review-recovery");
  const selected = await loadExplicitReviewRecovery({ token, parsed: params, userContext: { platformRole: "developer", isSuperuser: false } });
  if (!selected.ok) throw Error(JSON.stringify(selected));
  const full = { ...selected.data.existing, status: "working", routeContext: raw.routeContext, title: raw.title,
    objective: raw.objective, currentAgentId: raw.agentId,
    a2aMetadata: { ...row.a2aMetadata, riskClass: "bounded-write", initiativeReviewBinding: params.initiativeReviewBinding,
      requestedThreadId: null, collaborationKind: "handoff" },
    messages: [{ parts: [{ text: raw.prompt }] }], user: { id: "human", isActive: true, isSuperuser: true, groups: [] } };
  mocks.liveTask.mockResolvedValue(full);
  const effect = { taskRunId, apiTokenId: "new-token", userId: "human" };
  expect(await reviewRecoveryToolRefusal(effect)).toBeNull();
  mocks.current.mockResolvedValue(false);
  expect(await reviewRecoveryToolRefusal(effect)).toMatchObject({ success: false, error: "review_execution_authority_refused" });
  mocks.current.mockResolvedValue(true);
  expect(await reviewRecoveryToolRefusal({ ...effect, apiTokenId: "old-token" })).toMatchObject({ success: false });
  mocks.liveTask.mockResolvedValue({ ...full, status: "canceled" });
  expect(await reviewRecoveryToolRefusal(effect)).toMatchObject({ success: false });
  mocks.liveTask.mockRejectedValue(Error("authority store unavailable"));
  expect(await reviewRecoveryToolRefusal(effect)).toMatchObject({ success: false, error: "review_execution_authority_unavailable" });
});
