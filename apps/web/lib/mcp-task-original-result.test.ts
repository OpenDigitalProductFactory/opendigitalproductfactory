import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ task: vi.fn(), token: vi.fn(), agent: vi.fn(), room: vi.fn(), writers: vi.fn(), activity: vi.fn(), item: vi.fn(), agentAccess: vi.fn(), humanAccess: vi.fn(), outcome: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: {
  taskRun: { findUnique: db.task }, mcpApiToken: { findUnique: db.token }, agent: { findUnique: db.agent }, workroom: { findUnique: db.room },
  toolExecution: { findMany: db.writers }, backlogItemActivity: { findUnique: db.activity }, backlogItem: { findUnique: db.item },
} }));
vi.mock("./work-management/workroom-agent-access.server", () => ({ resolveAgentWorkroomAccess: db.agentAccess, resolveHumanWorkroomAccess: db.humanAccess }));
vi.mock("./mcp-task-review-outcome", () => ({ loadInitiativeReviewOutcome: db.outcome }));
import { readOriginalReviewResult, ORIGINAL_REVIEW_RESULT_CHAR_CAP } from "./mcp-task-original-result";
import { deterministicExternalTaskRunId, remoteTaskRequestDigest } from "./mcp-task-capacity-contract";
import { boundReviewReceiptId } from "./backlog/initiative-readiness/bound-review-effect";
import { parseRemoteTaskSubmitParams } from "./mcp-task-submit-params";

const at = new Date("2026-10-18T01:00:00Z");
const start = new Date("2026-10-18T00:59:00Z");
const scope = ["file_read", "backlog-item:BI-TEST", "tool:read_source_at_version", "tool:record_initiative_design_review"];
const raw = { agentId: "AGT-REVIEWER", routeContext: "/build", title: "Original review", objective: "Review the exact source", prompt: "Review the exact source",
  idempotencyKey: "original-review", riskClass: "bounded-write", collaborationKind: "handoff", authorityScope: scope,
  initiativeReviewBinding: { writerToolName: "record_initiative_design_review", itemId: "BI-TEST", gate: "design-spec",
    artifactRef: { kind: "repo-blob-at-commit" as const, repositoryFullName: "org/repo", commitSha: "a".repeat(40), path: "docs/spec.md", providerBlobId: "b".repeat(40) },
    workroomRef: { kind: "workroom-head" as const, workroomId: "WC-TEST", repositoryFullName: "org/repo", branchName: "codex/original", headSha: "a".repeat(40) } } };
const parsed = parseRemoteTaskSubmitParams(raw);
if (typeof parsed === "string") throw Error(parsed);
const digest = remoteTaskRequestDigest(parsed);
const taskRunId = deterministicExternalTaskRunId("oauth-family:original", raw.idempotencyKey);
const row = { id: "task-row", taskRunId, userId: "human", threadId: "thread", contextId: "context", status: "input-required", createdAt: start, updatedAt: at,
  routeContext: raw.routeContext, title: raw.title, objective: raw.objective, currentAgentId: raw.agentId, authorityScope: scope,
  a2aMetadata: { trigger: "external-mcp", tokenSource: "oauth", tokenCapability: "write", apiTokenId: "origin-token", taskAuthorityKey: "oauth-family:original",
    idempotencyKey: raw.idempotencyKey, requestDigestVersion: 2, requestDigest: digest, riskClass: raw.riskClass, collaborationKind: "handoff",
    requestedAgentId: raw.agentId, initiativeReviewBinding: raw.initiativeReviewBinding },
  progressPayload: { terminalWriterWait: { schemaVersion: 1, kind: "missing-terminal-writer", writerToolName: raw.initiativeReviewBinding.writerToolName,
    resumeMode: "same-taskrun", attempt: 1, observedAt: at.toISOString(), dispatchContract: "receipt-verified" },
    dispatch: { schemaVersion: 1, kind: "external-mcp-task", state: "claimed", attempt: 1, eventId: `mcp-task-run:${taskRunId}:execute:1`, claimedAt: start.toISOString() },
    executionUncertainty: { schemaVersion: 1, kind: "execution-uncertain", settlement: "unknown", observedAt: at.toISOString(), providerId: "anthropic-sub",
      diagnostics: { exitCode: 1, signal: null, timedOut: false, outerProcessClosed: true, stdoutPresent: true, stderrPresent: true, childProcessClosure: "unverified" } } },
  messages: [{ parts: [{ text: raw.prompt }] }], user: { id: "human", isActive: true, isSuperuser: false, groups: [{ platformRole: { roleId: "developer" } }] } };
const input = { taskRunId, userId: "human", actingAgentId: "AGT-AUTHOR", tokenGrantScopes: ["backlog_read"], expected: { requestDigest: digest, updatedAt: at.toISOString() } };
const receiptId = boundReviewReceiptId({ boundReviewTask: { taskRunId, requestDigest: digest }, actionKey: raw.initiativeReviewBinding.writerToolName,
  itemId: "BI-TEST", gate: "design-spec", artifactRef: raw.initiativeReviewBinding.artifactRef,
  reviewerUserId: "human", reviewerAgentId: raw.agentId, authorityDecisionId: "AUTH-1" }, "artifact-digest")!;
const receipt = { schemaVersion: 1, receiptId, policyVersion: "initiative-readiness.v1", gate: "design-spec", decision: "fail", subject: { kind: "backlog-item", id: "BI-TEST" },
  artifactRef: raw.initiativeReviewBinding.artifactRef, artifactDigest: "artifact-digest", artifactAuthorRef: "principal-author", reviewerPrincipalId: "principal-reviewer",
  reviewerAgentId: raw.agentId, authorityDecisionId: "AUTH-1", authoritySnapshot: { decision: "allow", effectiveHumanCapability: "manage_backlog", effectiveAgentGrant: "initiative_design_review",
    tokenScope: "write", organizationId: "platform", actionKey: raw.initiativeReviewBinding.writerToolName, policyVersion: "coworker-authority.v1" },
  reason: "Private reviewer explanation", findingRefs: ["finding-1"], resolvedFindingRefs: [] };
const writer = { id: "writer-1", taskRunId, userId: "human", agentId: raw.agentId, threadId: "thread", toolName: raw.initiativeReviewBinding.writerToolName,
  success: true, executionMode: "internal-mcp-session", createdAt: new Date("2026-10-18T00:59:40Z"), result: { success: true, data: { receiptId }, message: "Private native output" } };

beforeEach(() => {
  vi.resetAllMocks(); db.task.mockResolvedValue(structuredClone(row)); db.token.mockResolvedValue({ userId: "human", agentId: "AGT-AUTHOR" });
  db.agent.mockResolvedValue({ status: "active", archived: false, toolGrants: [{ grantKey: "backlog_read" }] });
  db.room.mockResolvedValue({ id: "room-row", backlogItemId: "BI-TEST", repositoryFullName: "org/repo", headBranch: "codex/original", headSha: "a".repeat(40) });
  db.agentAccess.mockResolvedValue({ decision: { level: "content" } }); db.humanAccess.mockResolvedValue({ decision: { level: "content" } });
  db.writers.mockResolvedValue([]); db.activity.mockResolvedValue({ id: receiptId, recordedAt: writer.createdAt, payload: structuredClone(receipt) });
  db.outcome.mockResolvedValue({ receiptId, gate: "design-spec", decision: "fail", artifactRef: raw.initiativeReviewBinding.artifactRef });
});

describe("original review read-only evidence collection", () => {
  it("preserves original native observations but leaves unverified children unknown", async () => {
    const result = await readOriginalReviewResult(input);
    expect(result).toMatchObject({ classification: "unknown", readOnly: true, replayAllowed: false,
      binding: { requestDigest: digest, attempt: 1 }, missingProof: expect.arrayContaining(["authoritative-child-closure"]) });
    expect(result?.observations).toEqual(expect.arrayContaining([expect.objectContaining({ source: "TaskRun.progressPayload.executionUncertainty", recordedAt: at.toISOString(),
      facts: expect.objectContaining({ childProcessClosure: "unverified", outerProcessClosed: true }) })]));
    expect(JSON.stringify(result)).not.toContain(raw.prompt);
  });

  it("preserves a native budget refusal without converting it to a verdict or replay permission", async () => {
    const value = structuredClone(row);
    Object.assign(value.progressPayload.executionUncertainty.diagnostics, { terminalResult: {
      status: "error", type: "result", subtype: "error_max_budget_usd", isError: true, hint: "quota",
    } });
    db.task.mockResolvedValue(value);
    const result = await readOriginalReviewResult(input);
    expect(result).toMatchObject({ classification: "unknown", replayAllowed: false });
    expect(result?.observations).toEqual(expect.arrayContaining([expect.objectContaining({
      source: "TaskRun.progressPayload.executionUncertainty", facts: expect.objectContaining({
        terminalStatus: "error", terminalSubtype: "error_max_budget_usd", childProcessClosure: "unverified",
      }),
    })]));
    expect(result).not.toHaveProperty("receipt");
  });

  it("returns the genuine checkpoint-bound receipt outcome without healing or removing uncertainty", async () => {
    db.writers.mockResolvedValue([writer]);
    const result = await readOriginalReviewResult(input);
    expect(result).toMatchObject({ classification: "receipt-complete", receipt: { receiptId, gate: "design-spec", decision: "fail" }, replayAllowed: false });
    expect(result?.observations.some(value => value.source === "TaskRun.progressPayload.executionUncertainty")).toBe(true);
    expect(result?.observations).toEqual(expect.arrayContaining([expect.objectContaining({ source: "ToolExecution", facts: expect.objectContaining({ id: "writer-1" }), digest: expect.stringMatching(/^[a-f0-9]{64}$/) })]));
    expect(JSON.stringify(result)).not.toMatch(/Private native output|Private reviewer explanation/);
    expect(db.outcome).toHaveBeenCalledWith(expect.objectContaining({ itemId: "BI-TEST" }), receiptId);
  });

  it.each(["owner", "actor", "room", "revoked", "scope", "agent-grant"])("returns no protected provenance after %s denial", async failure => {
    if (failure === "owner") db.task.mockResolvedValue({ ...row, userId: "other" });
    if (failure === "actor") db.token.mockResolvedValue({ userId: "human", agentId: "AGT-OTHER" });
    if (failure === "room" || failure === "revoked") db.agentAccess.mockResolvedValue({ decision: { level: "none" } });
    if (failure === "agent-grant") db.agent.mockResolvedValue({ status: "active", archived: false, toolGrants: [] });
    const result = await readOriginalReviewResult(failure === "scope" ? { ...input, tokenGrantScopes: [] } : input);
    expect(result).toMatchObject({ classification: "unknown", observations: [] });
    expect(result).not.toHaveProperty("binding"); expect(result).not.toHaveProperty("receipt"); expect(db.writers).not.toHaveBeenCalled();
  });

  it.each(["digest", "task", "reviewer", "writer", "artifact", "checkpoint", "attempt"])("refuses mismatched %s binding", async failure => {
    const value = structuredClone(row);
    if (failure === "digest") value.a2aMetadata.requestDigest = "f".repeat(64);
    if (failure === "task") value.taskRunId = "TR-OTHER";
    if (failure === "reviewer") value.currentAgentId = "AGT-OTHER";
    if (failure === "writer") value.progressPayload.terminalWriterWait.writerToolName = "record_initiative_security_review";
    if (failure === "artifact") value.a2aMetadata.initiativeReviewBinding.artifactRef.providerBlobId = "c".repeat(40);
    if (failure === "checkpoint") value.updatedAt = new Date(at.getTime() + 1);
    if (failure === "attempt") value.progressPayload.terminalWriterWait.attempt = 2;
    db.task.mockResolvedValue(value);
    expect(await readOriginalReviewResult(input)).toMatchObject({ classification: "unknown" });
    expect(db.outcome).not.toHaveBeenCalled();
  });

  it.each(["task", "writer", "reviewer", "owner", "old-attempt", "late", "receipt", "artifact"])("never accepts a %s writer/receipt substitute", async failure => {
    const value = structuredClone(writer);
    if (failure === "task") value.taskRunId = "TR-OTHER";
    if (failure === "writer") value.toolName = "record_initiative_security_review";
    if (failure === "reviewer") value.agentId = "AGT-OTHER";
    if (failure === "owner") value.userId = "other";
    if (failure === "old-attempt") value.createdAt = new Date(start.getTime() - 1);
    if (failure === "late") value.createdAt = new Date(at.getTime() + 1);
    if (failure === "receipt") value.result.data.receiptId = "another-receipt";
    if (failure === "artifact") db.outcome.mockResolvedValue(null);
    db.writers.mockResolvedValue([value]);
    expect(await readOriginalReviewResult(input)).toMatchObject({ classification: "unknown" });
  });

  it("rejects printable child closure and absent writer records as settlement proof", async () => {
    const value = structuredClone(row);
    (value.progressPayload.executionUncertainty.diagnostics as Record<string, unknown>).childProcessClosure = "verified";
    (value.progressPayload as Record<string, unknown>).nativeDispatch = { dispatched: false, childClosure: "verified" };
    db.task.mockResolvedValue(value);
    const result = await readOriginalReviewResult(input);
    expect(result?.classification).toBe("unknown");
    expect(JSON.stringify(result)).not.toContain('"childProcessClosure":"verified"');
  });

  it("labels a legacy diagnostic's checkpoint timestamp without inventing its observation time", async () => {
    const value = structuredClone(row);
    delete (value.progressPayload.executionUncertainty as Record<string, unknown>).observedAt;
    db.task.mockResolvedValue(value);
    expect((await readOriginalReviewResult(input))?.observations).toEqual(expect.arrayContaining([expect.objectContaining({
      source: "TaskRun.progressPayload.executionUncertainty", recordedAt: at.toISOString(), facts: expect.objectContaining({ observedAtMissing: true, childProcessClosure: "unverified" }),
    })]));
  });

  it("does not confuse queue dispatch attempts with bounded writer attempts", async () => {
    const value = structuredClone(row); value.progressPayload.dispatch.attempt = 3;
    value.progressPayload.dispatch.eventId = `mcp-task-run:${taskRunId}:execute:3`;
    db.task.mockResolvedValue(value); db.writers.mockResolvedValue([writer]);
    expect(await readOriginalReviewResult(input)).toMatchObject({ classification: "receipt-complete", binding: { dispatchAttempt: 3, writerAttempt: 1 } });
  });

  it("does not relabel another task's queue event as this original native dispatch", async () => {
    const value = structuredClone(row); value.progressPayload.dispatch.eventId = "mcp-task-run:TR-OTHER:execute:1";
    db.task.mockResolvedValue(value); db.writers.mockResolvedValue([writer]);
    expect(await readOriginalReviewResult(input)).toMatchObject({ classification: "unknown", observations: [] });
    expect(db.writers).not.toHaveBeenCalled();
  });

  it("queries the current checkpoint window so prior writer history cannot shadow its genuine receipt", async () => {
    db.writers.mockResolvedValue([writer]);
    expect((await readOriginalReviewResult(input))?.classification).toBe("receipt-complete");
    expect(db.writers).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      taskRunId, toolName: raw.initiativeReviewBinding.writerToolName, createdAt: { gte: start },
    }) }));
  });

  it("invalidates concurrent checkpoint reconciliation", async () => {
    db.writers.mockResolvedValue([writer]);
    db.task.mockResolvedValueOnce(structuredClone(row)).mockResolvedValue({ ...row, status: "completed", updatedAt: new Date(at.getTime() + 1) });
    expect(await readOriginalReviewResult(input)).toMatchObject({ classification: "unknown", reason: "original-snapshot-changed", observations: [] });
  });

  it("invalidates writer effects arriving during collection without advancing the TaskRun", async () => {
    db.writers.mockResolvedValueOnce([]).mockResolvedValue([writer]);
    expect(await readOriginalReviewResult(input)).toMatchObject({ classification: "unknown", reason: "original-snapshot-changed" });
  });

  it("rechecks current room authority after evidence collection", async () => {
    db.writers.mockResolvedValue([writer]); db.agentAccess.mockResolvedValueOnce({ decision: { level: "content" } }).mockResolvedValue({ decision: { level: "none" } });
    const result = await readOriginalReviewResult(input);
    expect(result).toMatchObject({ classification: "unknown", observations: [] }); expect(result).not.toHaveProperty("binding");
  });

  it("withholds collected evidence if the acting coworker's read grant is revoked", async () => {
    db.writers.mockResolvedValue([writer]);
    db.agent.mockResolvedValueOnce({ status: "active", archived: false, toolGrants: [{ grantKey: "backlog_read" }] }).mockResolvedValue({ status: "active", archived: false, toolGrants: [] });
    const result = await readOriginalReviewResult(input);
    expect(result).toMatchObject({ classification: "unknown", observations: [] }); expect(result).not.toHaveProperty("receipt");
  });

  it("preserves a real capacity refusal as an observation without authorizing another attempt", async () => {
    db.task.mockResolvedValue({ ...row, progressPayload: { ...row.progressPayload, resourceWait: { schemaVersion: 1, kind: "provider-capacity", failureKind: "capacity",
      resumeMode: "same-taskrun", attempt: 5, observedAt: at.toISOString(), nextAttemptAt: at.toISOString() } } });
    const result = await readOriginalReviewResult(input);
    expect(result).toMatchObject({ classification: "unknown", replayAllowed: false });
    expect(result?.observations).toEqual(expect.arrayContaining([expect.objectContaining({ source: "TaskRun.progressPayload.resourceWait", facts: expect.objectContaining({ failureKind: "capacity", attempt: 5 }) })]));
  });

  it("refuses overflowing evidence rather than returning a successful-looking partial receipt", async () => {
    db.writers.mockResolvedValue(Array.from({ length: 9 }, (_, i) => ({ ...writer, id: `writer-${i}` })));
    const result = await readOriginalReviewResult(input);
    expect(result).toMatchObject({ classification: "unknown", reason: "original-result-over-budget", observations: [] });
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(ORIGINAL_REVIEW_RESULT_CHAR_CAP);
  });

  it("returns null only for a non-review task, while malformed review metadata stays closed", async () => {
    db.task.mockResolvedValue({ ...row, a2aMetadata: {} }); expect(await readOriginalReviewResult(input)).toBeNull();
    db.task.mockResolvedValue({ ...row, a2aMetadata: { initiativeReviewBinding: {} } });
    expect(await readOriginalReviewResult(input)).toMatchObject({ classification: "unknown" });
  });
});
