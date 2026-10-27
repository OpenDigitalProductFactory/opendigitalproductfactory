import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ collect: vi.fn(), liveTask: vi.fn(), cas: vi.fn(), reads: vi.fn(), writer: vi.fn(), tasks: vi.fn(), task: vi.fn(), token: vi.fn(), current: vi.fn(), authorize: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { taskRun: { findFirst: mocks.task, findUnique: mocks.liveTask, findMany: mocks.tasks, updateMany: mocks.cas }, toolExecution: { findMany: mocks.reads, findFirst: mocks.writer }, mcpApiToken: { findUnique: mocks.token } } }));
vi.mock("./auth/oauth-tokens", () => ({ OAUTH_EXECUTION_AUTHORITY_SELECT: {}, isCurrentOAuthExecutionAuthority: mocks.current }));
vi.mock("./mcp/independent-review-request", () => ({ authorizeCoworkerRequest: mocks.authorize }));
vi.mock("./mcp-task-original-result", () => ({ readOriginalReviewResult: mocks.collect }));
import { loadExplicitReviewRecovery } from "./mcp-task-review-recovery";
import { deterministicExternalTaskRunId, remoteTaskRequestDigest } from "./mcp-task-capacity-contract";
import { parseRemoteTaskSubmitParams } from "./mcp-task-submit-params";
import { captureTaskExecutionFence } from "./shared/task-execution-fence";

const scope = ["file_read", "backlog-item:BI-TEST", "tool:read_source_at_version", "tool:record_initiative_architecture_review"];
const raw = { agentId: "AGT-WS-EA", routeContext: "/build", title: "Review", objective: "Review", prompt: "Review",
  idempotencyKey: "review-original", riskClass: "bounded-write", collaborationKind: "handoff", authorityScope: scope,
  initiativeReviewBinding: { itemId: "BI-TEST", gate: "architecture-review", writerToolName: "record_initiative_architecture_review",
    artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "org/repo", commitSha: "a".repeat(40), path: "docs/design.md", providerBlobId: "b".repeat(40) },
    workroomRef: { kind: "workroom-head", workroomId: "WC-TEST", repositoryFullName: "org/repo", branchName: "fix/test", headSha: "a".repeat(40) } } };
const normalized = (() => {
  const parsed = parseRemoteTaskSubmitParams(raw);
  if (typeof parsed === "string") throw Error(parsed);
  return parsed;
})();
const digest = remoteTaskRequestDigest(normalized);
const taskRunId = deterministicExternalTaskRunId("oauth-family:original", raw.idempotencyKey);
const updatedAt = new Date("2026-10-13T18:00:00.053Z");
const row = { id: "row-original", taskRunId, userId: "human", currentAgentId: raw.agentId, threadId: "thread-original", contextId: "context-original",
  status: "input-required", updatedAt, lastHeartbeatAt: null, completedAt: null, authorityScope: scope,
  a2aMetadata: { apiTokenId: "old-token", tokenSource: "oauth", tokenCapability: "write", taskAuthorityKey: "oauth-family:original", idempotencyKey: raw.idempotencyKey,
    requestedAgentId: raw.agentId, requestDigestVersion: 2, requestDigest: digest, initiativeReviewBinding: normalized.initiativeReviewBinding },
  progressPayload: { terminalWriterWait: { schemaVersion: 1, kind: "missing-terminal-writer", resumeMode: "same-taskrun",
    writerToolName: raw.initiativeReviewBinding.writerToolName, dispatchContract: "required-tool-call", attempt: 1, observedAt: updatedAt.toISOString() } } };
const token = { tokenId: "new-token", userId: "human", source: "oauth" as const, capability: "write" as const };
const params = { ...normalized, reviewRecovery: { taskRunId, requestDigest: digest, expectedUpdatedAt: updatedAt.toISOString() } };
const current = { userId: "human", agentId: "AGT-EXT-CODEX", capability: "write", authorityBindingId: "new-binding", scopes: ["file_read"], oauthClient: { registrationKind: "dcr" } };

beforeEach(() => {
  vi.resetAllMocks(); mocks.task.mockResolvedValue(structuredClone(row));
  mocks.token.mockImplementation(async ({ where }: { where: { id: string } }) => where.id === "new-token" ? current : { userId: "human", agentId: "AGT-EXT-CODEX" });
  mocks.current.mockResolvedValue(true); mocks.authorize.mockResolvedValue({ bounded: true });
  mocks.collect.mockResolvedValue(null);
});

it("refuses held legacy bound callbacks without a transferred-authority marker", async () => {
  const { reviewRecoveryToolRefusal } = await import("./mcp-task-review-recovery");
  mocks.liveTask.mockResolvedValue({ ...row, currentAgentId: raw.agentId,
    a2aMetadata: { ...row.a2aMetadata, trigger: "external-mcp", initiativeReviewBinding: raw.initiativeReviewBinding },
    progressPayload: { executionUncertainty: { schemaVersion: 1, kind: "execution-uncertain", settlement: "unknown" } },
  });
  expect(await reviewRecoveryToolRefusal({ taskRunId, userId: "human", apiTokenId: "old-token" }))
    .toMatchObject({ success: false, error: "review_execution_authority_refused" });
});

it.each(["current", "held", "canceled", "unversioned", "generation", "actor", "owner", "request"])("checks every legacy bound callback: %s", async mode => {
  const { reviewRecoveryToolRefusal } = await import("./mcp-task-review-recovery");
  const task = { ...row, status: "working", currentAgentId: raw.agentId, progressPayload: {} as Record<string, unknown>,
    a2aMetadata: { ...row.a2aMetadata, initiativeReviewBinding: raw.initiativeReviewBinding } };
  if (mode === "held") task.status = "input-required";
  if (mode === "canceled") task.status = "canceled";
  if (mode === "generation") task.progressPayload.resumeReservedAt = "later";
  if (mode === "actor") task.currentAgentId = "other";
  if (mode === "owner") task.userId = "other";
  if (mode === "request") task.a2aMetadata.requestDigest = "f".repeat(64);
  mocks.liveTask.mockResolvedValue(task);
  const result = await reviewRecoveryToolRefusal({ taskRunId, userId: "human", actingAgentId: raw.agentId,
    executionFence: mode === "unversioned" ? null : captureTaskExecutionFence({}, digest) });
  if (mode === "current") expect(result).toBeNull();
  else expect(result).toMatchObject({ success: false, error: "review_execution_authority_refused" });
});

it.each([{}, { initiativeReviewBinding: null }])("preserves unrelated nonreview callbacks with absent binding %j", async metadata => {
  const { reviewRecoveryToolRefusal } = await import("./mcp-task-review-recovery");
  mocks.liveTask.mockResolvedValue({ ...row, progressPayload: {}, a2aMetadata: metadata });
  expect(await reviewRecoveryToolRefusal({ taskRunId, userId: "human" })).toBeNull();
});

it.each([null, {}, { schemaVersion: 1, manifestArtifactId: "sealed", manifestDigest: "f".repeat(64) }])(
  "refuses a prospective restricted callback outside its captured execution scope: %j", async marker => {
    const { reviewRecoveryToolRefusal } = await import("./mcp-task-review-recovery");
    mocks.liveTask.mockResolvedValue({ ...row, status: "working", currentAgentId: raw.agentId, progressPayload: {},
      a2aMetadata: { ...row.a2aMetadata, initiativeReviewBinding: raw.initiativeReviewBinding, reassessmentExecution: marker } });
    expect(await reviewRecoveryToolRefusal({ taskRunId, userId: "human", actingAgentId: raw.agentId,
      executionFence: captureTaskExecutionFence({}, digest) }))
      .toMatchObject({ success: false, error: "review_execution_authority_refused" });
  });

it.each([undefined, {}, { ...raw.initiativeReviewBinding, schemaVersion: 2 },
  { ...raw.initiativeReviewBinding, artifactRef: { kind: "unknown-version" } }])(
  "refuses malformed or unknown immutable bindings even with a current full fence: %j", async binding => {
    const { reviewRecoveryToolRefusal } = await import("./mcp-task-review-recovery");
    mocks.liveTask.mockResolvedValue({ ...row, status: "working", currentAgentId: raw.agentId,
      progressPayload: {}, a2aMetadata: { ...row.a2aMetadata, initiativeReviewBinding: binding } });
    expect(await reviewRecoveryToolRefusal({ taskRunId, userId: "human", actingAgentId: raw.agentId,
      executionFence: captureTaskExecutionFence({}, digest) }))
      .toMatchObject({ success: false, error: "review_execution_authority_refused" });
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

it("delivers read-only evidence and exact Tasks/result locator for an uncertain same-family original", async () => {
  const { issueOriginalReviewRecoveryTarget } = await import("./mcp-task-review-recovery");
  const packet = { targetAgent: raw.agentId, objective: raw.objective, questionPacketSummary: raw.title,
    requestKey: raw.idempotencyKey, initiativeReviewBinding: raw.initiativeReviewBinding };
  mocks.tasks.mockResolvedValue([{ ...row, progressPayload: { executionUncertainty: {} } }]);
  const collected = { schemaVersion: 1, taskRunId, classification: "unknown", readOnly: true,
    replayAllowed: false, reason: "No verified child closure.", observations: [], missingProof: ["child-closure"], bounded: true };
  mocks.collect.mockResolvedValue(collected);
  expect(await issueOriginalReviewRecoveryTarget({ packet, userId: "human", actingAgentId: "AGT-EXT-CODEX",
    taskAuthorityKey: "oauth-family:original", tokenGrantScopes: ["backlog_read"] })).toMatchObject({
    kind: "refused", reason: "original-review-not-safely-resumable", originalResult: collected,
    resultRead: { method: "tasks/result", params: { taskId: taskRunId, requestDigest: digest } },
  });
  expect(mocks.collect).toHaveBeenCalledWith({ taskRunId, userId: "human", actingAgentId: "AGT-EXT-CODEX",
    tokenGrantScopes: ["backlog_read"], expected: { requestDigest: digest, updatedAt: updatedAt.toISOString() } });
  expect(mocks.cas).not.toHaveBeenCalled();
  expect(mocks.authorize).not.toHaveBeenCalled();
});

it("does not collect another original owner's evidence or return its result locator", async () => {
  const { issueOriginalReviewRecoveryTarget } = await import("./mcp-task-review-recovery");
  mocks.tasks.mockResolvedValue([{ ...row, progressPayload: { executionUncertainty: {} } }]);
  mocks.token.mockResolvedValue({ userId: "different-human", agentId: "AGT-EXT-CODEX" });
  const result = await issueOriginalReviewRecoveryTarget({ packet: { targetAgent: raw.agentId,
    objective: raw.objective, questionPacketSummary: raw.title, requestKey: raw.idempotencyKey,
    initiativeReviewBinding: raw.initiativeReviewBinding }, userId: "human", actingAgentId: "AGT-EXT-CODEX",
    taskAuthorityKey: "oauth-family:original" });
  expect(result).toEqual({ kind: "refused", reason: "original-human-or-coworker-mismatch" });
  expect(mocks.collect).not.toHaveBeenCalled();
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
  const effect = { taskRunId, apiTokenId: "new-token", userId: "human", actingAgentId: raw.agentId,
    executionFence: captureTaskExecutionFence(full.progressPayload, digest) };
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

const reviewerKey = (agent: string) => `${raw.idempotencyKey}:reviewer:${createHash("sha256").update(agent).digest("hex")}`;
function aliasTask(key: string, family = "oauth-family:original", agent = raw.agentId) {
  return { ...structuredClone(row), currentAgentId: agent,
    taskRunId: deterministicExternalTaskRunId(family, key),
    a2aMetadata: { ...row.a2aMetadata, taskAuthorityKey: family, idempotencyKey: key, requestedAgentId: agent,
      initiativeReviewBinding: normalized.initiativeReviewBinding,
      requestDigest: remoteTaskRequestDigest({ ...normalized, agentId: agent, idempotencyKey: key }) } };
}
type AliasTask = ReturnType<typeof aliasTask>;
// Query-contract adapter: exercise which persisted rows the real guard asks for,
// rather than return rows that its exact-key query would never see.
function matchesAliasWhere(task: AliasTask, value: unknown): boolean {
  const where = value as Record<string, unknown>;
  if (Array.isArray(where.AND) && !where.AND.every(part => matchesAliasWhere(task, part))) return false;
  if (Array.isArray(where.OR) && !where.OR.some(part => matchesAliasWhere(task, part))) return false;
  if (typeof where.userId === "string" && task.userId !== where.userId) return false;
  const status = where.status as { notIn?: string[] } | undefined;
  if (status?.notIn?.includes(task.status)) return false;
  const filter = where.a2aMetadata as { path?: string[]; equals?: unknown; string_starts_with?: string } | undefined;
  if (filter) {
    let actual: unknown = task.a2aMetadata;
    for (const key of filter.path ?? []) actual = (actual as Record<string, unknown>)?.[key];
    if (Object.hasOwn(filter, "equals") && actual !== filter.equals) return false;
    if (filter.string_starts_with !== undefined && (typeof actual !== "string" || !actual.startsWith(filter.string_starts_with))) return false;
  }
  return true;
}
function inventory(tasks: AliasTask[]) {
  mocks.tasks.mockImplementation(async ({ where, take }: { where: unknown; take: number }) =>
    tasks.filter(task => matchesAliasWhere(task, where)).slice(0, take));
}
async function readAliasGuard(targetAgent = raw.agentId, family = "oauth-family:new") {
  const { issueOriginalReviewRecoveryTarget } = await import("./mcp-task-review-recovery");
  return issueOriginalReviewRecoveryTarget({ packet: { targetAgent, objective: raw.objective,
    questionPacketSummary: raw.title, requestKey: reviewerKey(targetAgent), initiativeReviewBinding: normalized.initiativeReviewBinding },
    userId: "human", actingAgentId: "AGT-EXT-CODEX", taskAuthorityKey: family });
}
function exhaust(task: AliasTask) {
  task.progressPayload.terminalWriterWait.attempt = 3;
  return task;
}

it("does not let a completed scoped key hide an unresolved unsuffixed original", async () => {
  const original = aliasTask(raw.idempotencyKey), completed = aliasTask(reviewerKey(raw.agentId), "oauth-family:new");
  completed.status = "completed";
  const tasks = [completed, original], before = JSON.stringify(tasks);
  inventory(tasks);
  expect(await readAliasGuard()).toMatchObject({ kind: "refused" });
  expect(JSON.stringify(tasks)).toBe(before);
  expect(mocks.cas).not.toHaveBeenCalled();
});

it("refuses coexisting unresolved original and scoped reviews across credential families", async () => {
  inventory([aliasTask(reviewerKey(raw.agentId), "oauth-family:new"), aliasTask(raw.idempotencyKey)]);
  expect(await readAliasGuard()).toMatchObject({ kind: "refused", reason: "original-review-ambiguous" });
  expect(mocks.collect).not.toHaveBeenCalled();
});

it("retains a legacy original when both the reviewer roster and OAuth family change", async () => {
  inventory([aliasTask(raw.idempotencyKey)]);
  expect(await readAliasGuard("reviewer-fixture-other")).toMatchObject({ kind: "refused" });
  expect(mocks.cas).not.toHaveBeenCalled();
});

it("inventories other scoped aliases even when no current scoped task exists", async () => {
  inventory([aliasTask(reviewerKey("reviewer-fixture-first"), "oauth-family:first", "reviewer-fixture-first"),
    aliasTask(reviewerKey("reviewer-fixture-second"), "oauth-family:second", "reviewer-fixture-second")]);
  expect(await readAliasGuard()).toMatchObject({ kind: "refused", reason: "original-review-ambiguous" });
});

it("preserves a fully proven same-family exhausted reviewer alternate without resetting its history", async () => {
  const tasks = [exhaust(aliasTask(raw.idempotencyKey))], before = JSON.stringify(tasks);
  inventory(tasks);
  expect(await readAliasGuard("reviewer-fixture-other", "oauth-family:original")).toEqual({ kind: "none" });
  expect(JSON.stringify(tasks)).toBe(before);
  expect(mocks.cas).not.toHaveBeenCalled();
});

it.each(["uncertain", "capacity", "writer-rejected", "approval", "cross-family", "quarantined"])(
  "never excludes an exhausted-looking %s original to admit a sibling", async condition => {
    const task = exhaust(aliasTask(raw.idempotencyKey));
    const progress = task.progressPayload as Record<string, unknown>;
    if (condition === "uncertain") progress.executionUncertainty = { schemaVersion: 1, kind: "execution-uncertain", settlement: "unknown" };
    if (condition === "capacity") Object.assign(task.progressPayload.terminalWriterWait, { capacityDeferred: true });
    if (condition === "writer-rejected") Object.assign(task.progressPayload.terminalWriterWait, {
      writerRejection: { schemaVersion: 1, error: "fixture-rejection", message: "Fixture packet was rejected.", observedAt: updatedAt.toISOString() } });
    if (condition === "approval") progress.approvalEnvelopeId = "approval-fixture";
    if (condition === "quarantined") progress.reassessmentQuarantine = { schemaVersion: 1, marker: "fixture" };
    inventory([task]);
    expect(await readAliasGuard("reviewer-fixture-other", condition === "cross-family" ? "oauth-family:new" : "oauth-family:original"))
      .toMatchObject({ kind: "refused" });
    expect(mocks.cas).not.toHaveBeenCalled();
  });

it("refuses an overflowing alias inventory instead of hiding a later unresolved original", async () => {
  inventory(Array.from({ length: 501 }, (_, index) => {
    const agent = `reviewer-fixture-${index}`;
    return exhaust(aliasTask(reviewerKey(agent), "oauth-family:original", agent));
  }));
  expect(await readAliasGuard("reviewer-fixture-other", "oauth-family:original"))
    .toMatchObject({ kind: "refused", reason: "original-review-history-limit" });
});

it("does not confuse a distinct original-key namespace with a reviewer alias", async () => {
  inventory([aliasTask(`${raw.idempotencyKey}-different`)]);
  expect(await readAliasGuard()).toEqual({ kind: "none" });
});

it("refuses a saved review whose current reviewer no longer matches its immutable requested reviewer", async () => {
  const task = aliasTask(reviewerKey(raw.agentId));
  task.currentAgentId = "reviewer-fixture-changed";
  inventory([task]);
  expect(await readAliasGuard()).toMatchObject({ kind: "refused" });
});

it("never excludes a counterfeit reviewer alias or another requesting coworker's exhausted task", async () => {
  inventory([exhaust(aliasTask(`${raw.idempotencyKey}:reviewer:${"e".repeat(64)}`))]);
  expect(await readAliasGuard("reviewer-fixture-other", "oauth-family:original")).toMatchObject({ kind: "refused" });
  inventory([exhaust(aliasTask(raw.idempotencyKey))]);
  mocks.token.mockResolvedValue({ userId: "human", agentId: "different-requesting-coworker" });
  expect(await readAliasGuard("reviewer-fixture-other", "oauth-family:original")).toMatchObject({ kind: "refused" });
});
