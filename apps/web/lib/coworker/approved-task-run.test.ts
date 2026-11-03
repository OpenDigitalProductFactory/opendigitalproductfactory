// BI-9FD11E5E — approving a request an external task parked resumes that task
// from what it stored, under the credential that submitted it, exactly once.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@dpf/db", () => ({ prisma: {} }));
const { resolveOAuthConsent } = vi.hoisted(() => ({ resolveOAuthConsent: vi.fn() }));
vi.mock("@/lib/auth/oauth-identity-binding", () => ({ resolveOAuthConsent }));
vi.mock("@/lib/govern/current-user-context", () => ({
  currentUserContext: async (userId: string) => ({ userId, platformRole: "admin", isSuperuser: false }),
}));
vi.mock("@/lib/mcp-task-submit-approval-recovery", () => ({ resumeApprovedTask: vi.fn() }));
vi.mock("@/lib/mcp-tools", () => ({ PLATFORM_TOOLS: [{ name: "record_initiative_evidence", sideEffect: true }] }));
vi.mock("@/lib/tak/agent-grants", () => ({
  getToolGrantMapping: () => ({ record_initiative_evidence: ["initiative_evidence_write"] }),
  expandGrants: (grants: string[]) => grants,
}));

const recovery = vi.hoisted(() => ({ load: vi.fn(), reconstruct: vi.fn(), validate: vi.fn() }));
vi.mock("@/lib/mcp-task-background-worker", () => ({ loadPersistedRemoteTask: recovery.load, reconstructPersistedRemoteTask: recovery.reconstruct }));
vi.mock("@/lib/mcp-task-review-recovery", async original => ({
  ...await original<typeof import("@/lib/mcp-task-review-recovery")>(), revalidateReviewExecutionAuthority: recovery.validate,
}));
import { runApprovedTaskRequest } from "./approved-task-run";

const envelope = { taskRunId: "TR-1", delegatingUserId: "user-1", manifestActionId: "record_initiative_evidence" };
const UPDATED = new Date("2026-09-23T16:00:00Z");

function fixtures(over: { task?: Record<string, unknown> | null; token?: Record<string, unknown> | null } = {}) {
  const task = over.task === null ? null : {
    id: "row-1", taskRunId: "TR-1", userId: "user-1", threadId: "thread-1", contextId: null,
    status: "input-required", progressPayload: {}, lastHeartbeatAt: null, completedAt: null, updatedAt: UPDATED,
    routeContext: "/build",
    a2aMetadata: {
      apiTokenId: "tok-1", requestedAgentId: "AGT-WS-REVIEW", riskClass: "bounded-write",
      initiativeReviewBinding: { writerToolName: "record_initiative_evidence" },
    },
    ...over.task,
  };
  const token = over.token === null ? null : {
    id: "tok-1", userId: "user-1", agentId: "AGT-EXT-CODEX", kind: "oauth_access", revokedAt: null,
    scope: "write", capability: "write", scopes: ["initiative_evidence_write"], publicScopes: ["dpf.work"],
    authorityBindingId: "binding-1", oauthClientId: "client-1", resource: "http://127.0.0.1:3000/api/mcp/v1",
    ...over.token,
  };
  return {
    db: { taskRun: { findUnique: vi.fn(async () => task) }, mcpApiToken: { findUnique: vi.fn(async () => token) } },
    resume: vi.fn(async () => ({ kind: "result" as const, result: { status: "completed", content: [{ type: "text", text: "Evidence recorded." }] } })),
  };
}

beforeEach(() => {
  resolveOAuthConsent.mockReset();
  resolveOAuthConsent.mockResolvedValue({ agentId: "AGT-EXT-CODEX" });
});

describe("runApprovedTaskRequest", () => {
  it("does not revive an uncertain legacy review when its old approval arrives", async () => {
    const { db, resume } = fixtures({ task: { progressPayload: { executionUncertainty: { settlement: "unknown" } } } });
    expect(await runApprovedTaskRequest(envelope, { db: db as never, resume: resume as never }))
      .toEqual({ status: "not-run", reason: "task-bound" });
    expect(resume).not.toHaveBeenCalled();
  });
  it("resumes the waiting task as the coworker it asked for, under the credential that submitted it", async () => {
    const { db, resume } = fixtures();
    await expect(runApprovedTaskRequest(envelope, { db: db as never, resume: resume as never }))
      .resolves.toEqual({ status: "executed", message: "Evidence recorded." });
    expect(resume).toHaveBeenCalledWith(expect.objectContaining({
      existing: expect.objectContaining({ taskRunId: "TR-1", status: "input-required", updatedAt: UPDATED }),
      userId: "user-1", tokenId: "tok-1", tokenScope: "write", routeContext: "/build", agentId: "AGT-WS-REVIEW",
      riskClass: "bounded-write", reviewWriterToolName: "record_initiative_evidence",
    }));
  });

  it("reports a replay that won the reservation as not waiting, not as a failure", async () => {
    const { db } = fixtures();
    const resume = vi.fn(async () => null);
    await expect(runApprovedTaskRequest(envelope, { db: db as never, resume: resume as never }))
      .resolves.toEqual({ status: "not-run", reason: "task-not-waiting" });
  });

  it("reports a task that now waits on another approval", async () => {
    const { db } = fixtures();
    const resume = vi.fn(async () => ({ kind: "result", result: { status: "input-required", content: [] } }));
    await expect(runApprovedTaskRequest(envelope, { db: db as never, resume: resume as never }))
      .resolves.toEqual({ status: "not-run", reason: "task-waiting-again" });
  });

  it.each([
    ["the task is gone", { task: null }, "task-bound"],
    ["the platform runs the task for itself", { task: { a2aMetadata: { requestedAgentId: "AGT-WS-REVIEW" } } }, "task-bound"],
    ["the task belongs to someone else", { task: { userId: "user-2" } }, "task-bound"],
    ["the task already moved on", { task: { status: "working" } }, "task-not-waiting"],
    ["the credential was revoked", { token: { revokedAt: new Date() } }, "credential-unavailable"],
    ["the credential is another person's", { token: { userId: "user-2" } }, "credential-unavailable"],
    ["the connection lost its consent binding", { token: { authorityBindingId: null } }, "consent-changed"],
    ["the connection no longer carries the grant", { token: { scopes: ["registry_read"] } }, "scope-insufficient"],
  ] as const)("does not resume when %s", async (_label, over, reason) => {
    const { db, resume } = fixtures(over as never);
    await expect(runApprovedTaskRequest(envelope, { db: db as never, resume: resume as never }))
      .resolves.toEqual({ status: "not-run", reason });
    expect(resume).not.toHaveBeenCalled();
  });

  it("does not resume when the consent now names a different assistant", async () => {
    resolveOAuthConsent.mockResolvedValue({ agentId: "AGT-EXT-GROK" });
    const { db, resume } = fixtures();
    await expect(runApprovedTaskRequest(envelope, { db: db as never, resume: resume as never }))
      .resolves.toEqual({ status: "not-run", reason: "consent-changed" });
    expect(resume).not.toHaveBeenCalled();
  });
});

it("approved recovery uses separately recorded current authority and refuses revocation without reverting to origin", async () => {
  const digest = "a".repeat(64);
  const metadata = { apiTokenId: "tok-old", tokenSource: "oauth", tokenCapability: "write", taskAuthorityKey: "oauth-family:old",
    requestDigest: digest, requestedAgentId: "AGT-WS-REVIEW", riskClass: "bounded-write",
    initiativeReviewBinding: { writerToolName: "record_initiative_evidence" } };
  const progress = { reviewExecutionAuthority: { schemaVersion: 1, tokenId: "tok-current", userId: "user-1", actingAgentId: "AGT-EXT-CODEX",
    requestDigest: digest, originTokenId: "tok-old", expectedPriorUpdatedAt: UPDATED.toISOString(), recordedAt: UPDATED.toISOString() } };
  const { db, resume } = fixtures({ task: { a2aMetadata: metadata, progressPayload: progress }, token: { id: "tok-current" } });
  recovery.load.mockResolvedValue({ updatedAt: UPDATED });
  recovery.reconstruct.mockReturnValue({ ok: true, data: { token: { tokenId: "tok-current", userId: "user-1", source: "oauth", capability: "write" }, parsed: {} } });
  recovery.validate.mockResolvedValue(true);
  expect(await runApprovedTaskRequest(envelope, { db: db as never, resume: resume as never })).toMatchObject({ status: "executed" });
  expect(resume).toHaveBeenCalledWith(expect.objectContaining({ tokenId: "tok-current", existing: expect.objectContaining({ a2aMetadata: metadata }) }));
  expect(db.mcpApiToken.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "tok-current" } }));
  resume.mockClear(); recovery.validate.mockResolvedValue(false);
  expect(await runApprovedTaskRequest(envelope, { db: db as never, resume: resume as never })).toMatchObject({ status: "not-run", reason: "task-bound" });
  expect(resume).not.toHaveBeenCalled();
});
