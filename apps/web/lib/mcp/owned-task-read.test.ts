import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolExecutionContext } from "@/lib/mcp-tool-types";

const state = vi.hoisted(() => ({ row: null as Record<string, unknown> | null,
  current: {} as Record<string, unknown>, origin: {} as Record<string, unknown>,
  user: {} as Record<string, unknown>, artifact: null as Record<string, unknown> | null,
  grants: ["agent_control_read", "backlog_read"], consent: true, roomAccess: true,
  onProjection: null as (() => void) | null }));
const mocks = vi.hoisted(() => ({
  db: { taskRun: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    mcpApiToken: { findUnique: vi.fn() }, user: { findUnique: vi.fn() }, agent: { findFirst: vi.fn() },
    taskArtifact: { findUnique: vi.fn() }, workroom: { findUnique: vi.fn() },
    externalEvidenceRecord: { findFirst: vi.fn() } },
  namespace: vi.fn(), room: vi.fn(), original: vi.fn(), recovery: vi.fn(), operation: vi.fn(), approval: vi.fn(),
}));
vi.mock("@dpf/db", () => ({ prisma: mocks.db }));
vi.mock("@/lib/auth/oauth-task-authority", () => ({ resolveMcpTaskAuthorityKey: mocks.namespace }));
vi.mock("@/lib/work-management/workroom-agent-access.server", () => ({ resolveAgentWorkroomAccess: mocks.room }));
vi.mock("@/lib/mcp-task-original-result", () => ({ readOriginalReviewResult: mocks.original }));
vi.mock("@/lib/change-review/semantic-review-recovery-readback", () => ({ readSemanticReviewRecovery: mocks.recovery }));
vi.mock("@/lib/inference/async-operation-runtime", () => ({ readPrismaAuthorizedAsyncOperation: mocks.operation,
  requestPrismaAuthorizedAsyncOperationCancellation: vi.fn() }));
vi.mock("./external-approval-location-lookup", () => ({ withTaskRunApprovalLocation: mocks.approval }));

import { workThreadPack } from "./packs/work-thread-pack";
import { deterministicExternalTaskRunId, remoteTaskRequestDigest } from "@/lib/mcp-task-capacity-contract";
import { createSemanticReviewRequest } from "@/lib/change-review/semantic-review-request";
import { deterministicTaskRunId } from "@/lib/change-review/semantic-review-single-flight";
import { failureAnalysisFixture } from "@/lib/change-review/failure-analysis.test-fixtures";
import type { RemoteTaskSubmitParams } from "@/lib/mcp-task-submit-params";
import { DURABLE_INFERENCE_TASK_CONTRACT_FAMILY, DURABLE_INFERENCE_TASK_RECIPE_ID } from "@/lib/mcp-task-durable-inference-contract";

const agentId = "AGT-EXT-CODEX";
const namespace = "oauth-family:reader-family";
const context = (): ToolExecutionContext => ({ agentId, apiTokenId: "current-token", authSource: "oauth",
  tokenScope: "read", tokenGrantScopes: ["agent_control_read", "backlog_read"] });
const read = (params: Record<string, unknown> = {}, ctx = context()) =>
  workThreadPack.handlers.get_mcp_task({ taskId: state.row?.taskRunId, ...params }, "human", ctx);

function external(extra: Partial<RemoteTaskSubmitParams> = {}) {
  const request: RemoteTaskSubmitParams = { agentId: "platform-engineer", routeContext: "/platform/ai", title: "Reconcile task",
    objective: "Return the permitted disposition", prompt: "Existing exact request", riskClass: "read" as const,
    authorityScope: [], idempotencyKey: "existing-owned-task", collaborationKind: "handoff", ...extra };
  return { id: "run-row", taskRunId: deterministicExternalTaskRunId(namespace, request.idempotencyKey),
    userId: "human", currentAgentId: request.agentId, threadId: "task-thread", contextId: null,
    routeContext: request.routeContext, title: request.title, objective: request.objective,
    authorityScope: request.authorityScope, status: "completed", createdAt: new Date(), updatedAt: new Date(), completedAt: new Date(),
    progressPayload: { summary: "Recorded disposition", request: { private: "excluded-request-marker" } },
    a2aMetadata: { trigger: "external-mcp", idempotencyKey: request.idempotencyKey,
      requestDigest: remoteTaskRequestDigest(request), requestDigestVersion: 2, requestObjective: request.objective,
      apiTokenId: "origin-token", taskAuthorityKey: namespace, tokenSource: "oauth", tokenCapability: "read",
      requestedAgentId: request.agentId, requestedThreadId: null, collaborationKind: "handoff", riskClass: "read",
      initiativeReviewBinding: request.initiativeReviewBinding ?? null,
      ...(request.recipeId ? { durableInference: { schemaVersion: 1, recipeId: request.recipeId } } : {}) },
    messages: [{ id: "first-request", parts: [{ kind: "text", text: request.prompt }] }], user: state.user };
}

function initiative() {
  const binding = { writerToolName: "record_initiative_design_review", itemId: "BI-READER", gate: "design-spec",
    expectedCurrentBaselineId: null, workroomRef: { kind: "workroom-head" as const, workroomId: "WC-READER",
      repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory", branchName: "codex/reader", headSha: "b".repeat(40) },
    artifactRef: { kind: "repo-blob-at-commit" as const, repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
      commitSha: "b".repeat(40), path: "docs/superpowers/specs/reader.md", providerBlobId: "a".repeat(40) } };
  state.row = external({ initiativeReviewBinding: binding,
    authorityScope: ["tool:record_initiative_design_review", "tool:read_source_at_version", "backlog-item:BI-READER"] });
  const row = state.row;
  const metadata = row.a2aMetadata as Record<string, unknown>;
  const value = { schemaVersion: 1, taskRunId: row.taskRunId, classification: "unknown", readOnly: true,
    replayAllowed: false, bounded: true, reason: "original-execution-proof-incomplete", observations: [],
    missingProof: ["no-unresolved-or-late-effects"], binding: { requestDigest: metadata.requestDigest,
      checkpointUpdatedAt: (row.updatedAt as Date).toISOString(), attempt: 1, dispatchAttempt: 1, writerAttempt: null,
      writerToolName: binding.writerToolName, reviewerAgentId: "platform-engineer", itemId: binding.itemId,
      gate: binding.gate, artifactRef: binding.artifactRef, workroomId: "WC-READER" } };
  mocks.original.mockResolvedValue(value);
  return value;
}

function durable() {
  state.row = external({ recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID });
  state.row.progressPayload = { durableInference: { schemaVersion: 1, recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
    state: "admitted", asyncOperationId: "operation-1" } };
  const operation = { operationId: "operation-1", requestKey: "existing-owned-task", requestDigest: "a".repeat(64),
    status: "completed", contractFamily: DURABLE_INFERENCE_TASK_CONTRACT_FAMILY,
    providerId: "recorded-provider", modelId: "recorded-model", providerOperationId: "provider-operation",
    checkpointSequence: 2, transitionSequence: 2, progressPct: 100, progressMessage: null,
    resultText: "Recorded durable result", resultData: { private: "excluded-operation-marker" }, errorMessage: null,
    createdAt: new Date(), updatedAt: new Date(), startedAt: new Date(), completedAt: new Date(),
    expiresAt: new Date(Date.now() + 600_000) };
  mocks.operation.mockResolvedValue({ operation, transitions: [], nextCursor: 2 });
  return operation;
}

function native() {
  const artifact = "exact source diff";
  const diffDigest = createHash("sha256").update(artifact).digest("hex");
  const packet = createSemanticReviewRequest({ surface: "external", authorSurface: "codex", artifactType: "code-change",
    title: "Required code review", artifact, changedFiles: ["reader.ts"], verificationEvidence: "Qualified gate record",
    ...failureAnalysisFixture({ capsuleId: "WC-READER", headTreeHash: "b".repeat(40), diffDigest }),
    identity: { capsuleId: "WC-READER", baseTreeHash: "a".repeat(40), headTreeHash: "b".repeat(40), diffDigest, specialistIds: [] },
  }, { userId: "human", agentId, apiTokenId: "origin-token", authSource: "oauth" });
  const taskRunId = deterministicTaskRunId(packet.gateKey, 1);
  state.row = { ...external(), taskRunId, currentAgentId: "change-reviewer", a2aMetadata: {
    gateKind: "semantic-review", gateKey: packet.gateKey, capsuleId: "WC-READER", attempt: 1 },
    progressPayload: { semanticReview: { schemaVersion: 1, requestDigest: packet.digest, state: "completed" },
      evidenceRecordId: "review-receipt" } };
  state.artifact = { id: `semantic-review-request:${taskRunId}`, artifactId: `semantic-review-request:${taskRunId}`,
    taskRunId: "run-row", parts: [{ kind: "data", data: packet }] };
  return packet;
}

beforeEach(() => {
  vi.clearAllMocks(); delete process.env.MCP_TASKS_LIFECYCLE;
  state.user = { id: "human", isActive: true, isSuperuser: true, automationExpiresAt: null, groups: [] };
  state.current = { userId: "human", agentId, kind: "oauth_access", revokedAt: null,
    expiresAt: new Date(Date.now() + 600_000), oauthClientId: "client", authorityBindingId: "binding",
    oauthFamilyKey: "reader-family", resource: "https://localhost/api/mcp/v1", publicScopes: ["dpf.read"],
    scopes: ["agent_control_read", "backlog_read"], capability: "read", oauthClient: { registrationKind: "dcr", revokedAt: null } };
  state.origin = { ...state.current, expiresAt: new Date(0), revokedAt: new Date(0) };
  state.grants = ["agent_control_read", "backlog_read"]; state.consent = true; state.roomAccess = true;
  state.artifact = null; state.onProjection = null; state.row = external();
  mocks.db.taskRun.findUnique.mockImplementation(async ({ select }) => {
    if (!state.row) return null;
    // Match the selected top-level shape: request messages are absent from the
    // lifecycle row, so the separate origin checkpoint must catch message races.
    return Object.fromEntries(Object.keys(select).map(key => [key, structuredClone(state.row![key])]));
  });
  mocks.db.mcpApiToken.findUnique.mockImplementation(async ({ where }) => structuredClone(where.id === "current-token" ? state.current : where.id === "origin-token" ? state.origin : null));
  mocks.db.user.findUnique.mockImplementation(async () => structuredClone(state.user));
  mocks.db.agent.findFirst.mockImplementation(async () => ({ toolGrants: state.grants.map(grantKey => ({ grantKey })), toolGrantRevocations: [] }));
  mocks.db.taskArtifact.findUnique.mockImplementation(async () => structuredClone(state.artifact));
  mocks.db.workroom.findUnique.mockResolvedValue({ id: "room-row", capsuleId: "WC-READER",
    repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory" });
  mocks.namespace.mockImplementation(async () => state.consent ? namespace : null);
  mocks.room.mockImplementation(async () => ({ decision: { level: state.roomAccess ? "content" : "none" } }));
  mocks.approval.mockImplementation(async value => { state.onProjection?.(); return value; });
  mocks.recovery.mockImplementation(async () => { state.onProjection?.(); return { classification: "completed",
    pollUseful: false, nextAction: "Read the recorded review; no retry is authorized.", details: {
      nodes: [], truncated: false, unresolvedNodeIds: [], remediation: { state: "missing-current-proof",
        executionSettled: false, retryAuthorized: false, nextAction: "Record actual execution proof before recovery." } } }; });
  mocks.db.externalEvidenceRecord.findFirst.mockResolvedValue({ id: "review-receipt", createdAt: new Date(),
    details: { schemaVersion: "semantic-change-review-receipt.v2", result: { decision: "pass", summary: "Exact review" } } });
  mocks.original.mockResolvedValue({ schemaVersion: 1, classification: "unknown", reason: "original-execution-proof-incomplete",
    observations: [], missingProof: ["no-unresolved-or-late-effects"], replayAllowed: false });
});

describe("owned MCP task read via the real pack handler", () => {
  it("reads same-user/assistant/family task status without thread read/write", async () => {
    expect(await read()).toMatchObject({ success: true, data: { taskId: state.row!.taskRunId, status: "completed", terminal: true } });
    expect(mocks.db.taskRun.findMany).not.toHaveBeenCalled();
    expect(mocks.db.taskRun.update).not.toHaveBeenCalled();
    expect(mocks.db.taskRun.updateMany).not.toHaveBeenCalled();
    expect(mocks.db.taskRun.create).not.toHaveBeenCalled();
  });
  it("supports new current credential with stale same-family origin", async () => {
    expect(await read({ mode: "result" })).toMatchObject({ success: true });
    expect(JSON.stringify(await read({ mode: "result" }))).not.toContain("excluded-request-marker");
  });
  it.each([null, 7, "", " ", "a".repeat(257), "TR\n1"])("rejects invalid exact ID %j before querying", async taskId => {
    expect(await read({ taskId })).toMatchObject({ success: false, error: "owned_task_read_invalid" });
    expect(mocks.db.taskRun.findUnique).not.toHaveBeenCalled();
  });
  it.each([{ mode: "cancel" }, { mode: 1 }, { mode: null }, { userId: "other" }, { tokenId: "origin-token" },
    { threadId: "foreign" }, { workroomId: "WC-OTHER" }, { method: "tasks/list" }])("rejects unsupported arguments %j", async params => {
    expect(await read(params)).toMatchObject({ success: false, error: "owned_task_read_invalid" });
    expect(mocks.db.taskRun.findUnique).not.toHaveBeenCalled();
  });
  it("honors lifecycle flag off before a task query", async () => {
    process.env.MCP_TASKS_LIFECYCLE = "off";
    expect(await read()).toMatchObject({ success: false });
    expect(mocks.db.taskRun.findUnique).not.toHaveBeenCalled();
  });
  it.each(["user", "family", "assistant", "missing-origin", "metadata-source", "idempotency", "prompt", "request-objective", "authority-scope"])("does not disclose mismatched external %s", async kind => {
    if (kind === "user") state.row!.userId = "other";
    if (kind === "family") (state.row!.a2aMetadata as Record<string, unknown>).taskAuthorityKey = "oauth-family:other";
    if (kind === "assistant") state.origin.agentId = "AGT-EXT-CLAUDE";
    if (kind === "missing-origin") state.origin = {};
    if (kind === "metadata-source") (state.row!.a2aMetadata as Record<string, unknown>).tokenSource = "session-jwt";
    if (kind === "idempotency") (state.row!.a2aMetadata as Record<string, unknown>).idempotencyKey = "changed";
    if (kind === "prompt") (state.row!.messages as Array<{ parts: unknown }>)[0].parts = [{ kind: "text", text: "changed" }];
    if (kind === "request-objective") (state.row!.a2aMetadata as Record<string, unknown>).requestObjective = "changed";
    if (kind === "authority-scope") state.row!.authorityScope = ["changed"];
    const result = await read({ mode: "result" });
    expect(result).toMatchObject({ success: false, error: "owned_task_read_unavailable" });
    expect(JSON.stringify(result)).not.toContain("Recorded disposition");
  });
  it("does not treat target coworker as submitting assistant", async () => {
    state.origin.agentId = "platform-engineer";
    expect(await read()).toMatchObject({ success: false });
  });
  it.each(["expired", "revoked", "credentials", "wrong-kind", "wrong-user", "wrong-agent", "consent", "token-scope", "agent-grant", "inactive-human"])("requires current interactive read authority: %s", async kind => {
    if (kind === "expired") state.current.expiresAt = new Date(0);
    if (kind === "revoked") state.current.revokedAt = new Date();
    if (kind === "credentials") state.current.oauthClient = { registrationKind: "credentials", revokedAt: null };
    if (kind === "wrong-kind") state.current.kind = "operator";
    if (kind === "wrong-user") state.current.userId = "other";
    if (kind === "wrong-agent") state.current.agentId = "AGT-EXT-CLAUDE";
    if (kind === "consent") state.consent = false;
    if (kind === "token-scope") state.current.scopes = [];
    if (kind === "agent-grant") state.grants = [];
    if (kind === "inactive-human") state.user.isActive = false;
    expect(await read()).toMatchObject({ success: false, error: "owned_task_read_unavailable" });
  });
  it.each([{ apiTokenId: undefined }, { agentId: undefined }, { authSource: "pat" }, { authSource: "session-jwt" },
    { tokenGrantScopes: [] }])("refuses absent or narrowed trusted context %j", async changed => {
    expect(await read({}, { ...context(), ...changed } as ToolExecutionContext)).toMatchObject({ success: false });
  });
  it.each(["row", "message", "token", "grant", "human", "consent", "task-date", "token-date"])("final fence discards %s drift during collection", async kind => {
    state.row!.status = "input-required";
    state.onProjection = () => {
      if (kind === "row") state.row!.userId = "other";
      if (kind === "message") (state.row!.messages as Array<{ parts: unknown }>)[0].parts = [{ kind: "text", text: "late change" }];
      if (kind === "token") state.current.scopes = [];
      if (kind === "grant") state.grants = [];
      if (kind === "human") state.user.isActive = false;
      if (kind === "consent") state.consent = false;
      if (kind === "task-date") state.row!.updatedAt = new Date((state.row!.updatedAt as Date).getTime() + 1);
      if (kind === "token-date") state.current.expiresAt = new Date((state.current.expiresAt as Date).getTime() + 600_000);
    };
    expect(await read({ mode: "result" })).toMatchObject({ success: false, error: "owned_task_read_unavailable" });
  });
  it("does not enumerate foreign and missing tasks through different errors", async () => {
    state.row!.userId = "other";
    const foreign = await read({ taskId: "TR-EXACT" }); state.row = null;
    expect(await read({ taskId: "TR-EXACT" })).toEqual(foreign);
  });
});

describe("native review admission and specialized guards", () => {
  it.each(["status", "result"])("rejects mixed external/native origin before protected reads in %s mode", async mode => {
    Object.assign(state.row!.a2aMetadata as Record<string, unknown>, {
      gateKind: "semantic-review", capsuleId: "WC-READER", gateKey: "a".repeat(64) });
    const result = await read({ mode });
    expect(mocks.recovery).not.toHaveBeenCalled();
    expect(mocks.original).not.toHaveBeenCalled();
    expect(mocks.db.taskArtifact.findUnique).not.toHaveBeenCalled();
    expect(mocks.db.externalEvidenceRecord.findFirst).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: false, error: "owned_task_read_unavailable" });
  });
  it.each(["status", "result"])("preserves authenticated initiative uncertainty in %s mode", async mode => {
    initiative();
    expect(await read({ mode })).toMatchObject({ success: true, data: {
      originalResult: { classification: "unknown", replayAllowed: false }, retryAuthorized: false } });
    expect(JSON.stringify(await read({ mode }))).not.toContain("Recorded disposition");
    expect(mocks.original).toHaveBeenCalledWith(expect.objectContaining({ actingAgentId: agentId,
      tokenGrantScopes: ["agent_control_read", "backlog_read"] }));
  });
  it.each(["status", "result"])("preserves genuine initiative receipt in %s mode", async mode => {
    const original = initiative();
    mocks.original.mockResolvedValue({ ...original, classification: "receipt-complete",
      receipt: { receiptId: "initiative-receipt", gate: "design-spec", decision: "fail" }, missingProof: [] });
    expect(await read({ mode })).toMatchObject({ success: true, data: {
      originalResult: { receipt: { receiptId: "initiative-receipt", decision: "fail" } } } });
  });
  it.each(["status", "result"])("refuses current initiative scope/room loss in %s mode", async mode => {
    initiative();
    mocks.original.mockResolvedValue({ schemaVersion: 1, taskRunId: state.row!.taskRunId, classification: "unknown",
      reason: "current-original-owner-content-access-required", readOnly: true, replayAllowed: false,
      bounded: true, observations: [], missingProof: ["current-original-owner-content-access-required"] });
    expect(await read({ mode })).toMatchObject({ success: false, error: "owned_task_read_unavailable" });
  });
  it("does not combine changed initiative receipt/proof with the original projection", async () => {
    const initial = initiative();
    mocks.original.mockResolvedValueOnce(initial).mockResolvedValue({ ...initial, reason: "original-snapshot-changed" });
    expect(await read({ mode: "result" })).toMatchObject({ success: false, error: "owned_task_read_unavailable" });
  });
  it("does not return a different intermediate initiative receipt even if final proof reverts", async () => {
    const initial = initiative();
    mocks.original.mockResolvedValueOnce(initial).mockResolvedValueOnce({ ...initial, classification: "receipt-complete",
      receipt: { receiptId: "intermediate-receipt", gate: "design-spec", decision: "pass" }, missingProof: [] }).mockResolvedValue(initial);
    expect(await read({ mode: "result" })).toMatchObject({ success: false, error: "owned_task_read_unavailable" });
  });
  it.each(["status", "result"])("uses canonical durable operation guard in %s mode", async mode => {
    durable();
    expect(await read({ mode })).toMatchObject({ success: true, data: { status: "completed", terminal: true } });
    expect(mocks.operation).toHaveBeenCalledWith({ target: { kind: "task-run", taskRunId: state.row!.taskRunId },
      actor: { userId: "human", agentId: null, principalId: null, isSuperuser: false }, requestKey: "existing-owned-task" });
    expect(JSON.stringify(await read({ mode }))).not.toContain("excluded-operation-marker");
  });
  it.each(["binding", "refusal"])("does not fall back after durable %s failure", async kind => {
    const operation = durable();
    if (kind === "binding") mocks.operation.mockResolvedValue({ operation: { ...operation, operationId: "wrong-operation" } });
    else mocks.operation.mockRejectedValue(new Error("private authority refusal"));
    expect(await read({ mode: "result" })).toMatchObject({ success: false, error: "owned_task_read_unavailable" });
  });
  it.each(["checkpoint", "authority"])("fences durable %s drift without a TaskRun timestamp change", async kind => {
    const operation = durable();
    mocks.operation.mockResolvedValueOnce({ operation });
    if (kind === "checkpoint") mocks.operation.mockResolvedValue({ operation: { ...operation, checkpointSequence: 3 } });
    else mocks.operation.mockRejectedValue(new Error("current operation authority removed"));
    expect(await read({ mode: "result" })).toMatchObject({ success: false, error: "owned_task_read_unavailable" });
  });
  it.each(["status", "result"])("supports an authentic native OAuth request in %s mode", async mode => {
    native();
    expect(await read({ mode })).toMatchObject({ success: true, data: { taskId: state.row!.taskRunId } });
    expect(mocks.room).toHaveBeenCalledWith(expect.objectContaining({ userId: "human", agentId, workroomId: "room-row", requested: "content" }));
  });
  it.each(["relation", "gate", "capsule", "digest", "session", "surface", "room", "artifact-race", "room-race"])("refuses invalid native %s without review content", async kind => {
    const packet = native();
    if (kind === "relation") state.artifact!.taskRunId = "another-run-row";
    if (kind === "gate") (state.row!.a2aMetadata as Record<string, unknown>).gateKey = "c".repeat(64);
    if (kind === "capsule") (state.row!.a2aMetadata as Record<string, unknown>).capsuleId = "WC-OTHER";
    if (kind === "digest") (state.row!.progressPayload as { semanticReview: { requestDigest: string } }).semanticReview.requestDigest = "c".repeat(64);
    if (kind === "session" || kind === "surface") {
      const replacement = createSemanticReviewRequest({ ...packet.input, ...(kind === "surface" ? { surface: "build-studio" } : {}) },
        { ...packet.actor, ...(kind === "session" ? { authSource: "session-jwt" } : {}) });
      state.artifact!.parts = [{ kind: "data", data: replacement }];
      (state.row!.progressPayload as { semanticReview: { requestDigest: string } }).semanticReview.requestDigest = replacement.digest;
      (state.row!.a2aMetadata as Record<string, unknown>).gateKey = replacement.gateKey;
      state.row!.taskRunId = deterministicTaskRunId(replacement.gateKey, 1);
      state.artifact!.artifactId = `semantic-review-request:${state.row!.taskRunId}`;
    }
    if (kind === "room") state.roomAccess = false;
    if (kind === "artifact-race") state.onProjection = () => { state.artifact!.parts = [{ kind: "data", data: { ...packet, digest: "c".repeat(64) } }]; };
    if (kind === "room-race") state.onProjection = () => { state.roomAccess = false; };
    const result = await read({ mode: "result" });
    expect(result).toMatchObject({ success: false, error: "owned_task_read_unavailable" });
    expect(JSON.stringify(result)).not.toContain("review-receipt");
  });
  it.each(["status", "result"])("keeps initiative refusal in %s mode without raw progress fallback", async mode => {
    (state.row!.a2aMetadata as Record<string, unknown>).initiativeReviewBinding = { malformed: true };
    expect(await read({ mode })).toMatchObject({ success: false });
    expect(JSON.stringify(await read({ mode }))).not.toContain("Recorded disposition");
  });
});
