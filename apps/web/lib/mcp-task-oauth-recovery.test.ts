import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ token: vi.fn(), current: vi.fn(), write: vi.fn(), envelope: vi.fn(), reserve: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: {
  mcpApiToken: { findUnique: mocks.token }, toolExecution: { findFirst: mocks.write },
  coworkerActionEnvelope: { findFirst: mocks.envelope }, taskRun: { updateMany: mocks.reserve },
} }));
vi.mock("./auth/oauth-tokens", () => ({ isCurrentOAuthExecutionAuthority: mocks.current, OAUTH_EXECUTION_AUTHORITY_SELECT: {} }));
vi.mock("./queue/mcp-task-run-events", () => ({ sendMcpTaskRunExecutionEvent: vi.fn() }));
import { recoverExpiredOAuthReview } from "./mcp-task-oauth-recovery";
const existing = { id: "row", taskRunId: "task", userId: "human", threadId: "thread", contextId: null,
  status: "failed", lastHeartbeatAt: null, completedAt: new Date(2000), updatedAt: new Date(2000),
  a2aMetadata: { tokenSource: "oauth", apiTokenId: "old", taskAuthorityKey: "oauth-family:family",
    initiativeReviewBinding: { writerToolName: "record_initiative_design_review" } },
  progressPayload: { errorCode: "authorization_revoked", dispatch: { attempt: 5 },
    resourceWait: { schemaVersion: 1, kind: "provider-capacity", attempt: 2, observedAt: "2026-09-27T23:32:00Z",
      nextAttemptAt: "2026-09-27T23:33:00Z", resumeMode: "same-taskrun", failureKind: "capacity" } },
};
const caller = { tokenId: "new", userId: "human", source: "oauth", capability: "write" } as const;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.token.mockResolvedValue({ userId: "human", oauthFamilyKey: "family", expiresAt: new Date(1000), revokedAt: null });
  mocks.current.mockResolvedValue(true); mocks.write.mockResolvedValue(null); mocks.envelope.mockResolvedValue(null);
  mocks.reserve.mockResolvedValue({ count: 1 });
});
it("reserves the same failed review once without resetting its dispatch or capacity history", async () => {
  expect(await recoverExpiredOAuthReview(existing, caller)).toBe(true);
  expect(mocks.reserve).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ taskRunId: "task", status: "failed", updatedAt: existing.updatedAt }),
    data: expect.objectContaining({ status: "submitted", progressPayload: expect.objectContaining({
      dispatch: expect.objectContaining({ attempt: 6 }), oauthExpiryRecovery: expect.objectContaining({ priorStatus: "failed" }),
      resourceWait: expect.objectContaining({ attempt: 2 }),
    }) }),
  }));
});
it.each(["canceled", "completed", "working"])("does not revive %s", async status => {
  expect(await recoverExpiredOAuthReview({ ...existing, status }, caller)).toBe(false);
  expect(mocks.reserve).not.toHaveBeenCalled();
});
it("refuses revoked authority", async () => {
  mocks.current.mockResolvedValue(false);
  expect(await recoverExpiredOAuthReview(existing, caller)).toBe(false);
  expect(mocks.reserve).not.toHaveBeenCalled();
});
it("never repeats a recorded reviewer write", async () => {
  mocks.write.mockResolvedValue({ id: "receipt" });
  expect(await recoverExpiredOAuthReview(existing, caller)).toBe(false);
});
it("loses a concurrent reservation without dispatching again", async () => {
  mocks.reserve.mockResolvedValue({ count: 0 });
  expect(await recoverExpiredOAuthReview(existing, caller)).toBe(false);
});
it.each([
  { oauthExpiryRecovery: { requestedAt: "earlier" } },
  { terminalWriterWait: { attempt: 3 } },
  { errorCode: "different_failure" },
])("refuses ineligible failure history %j", async change => {
  expect(await recoverExpiredOAuthReview({ ...existing, progressPayload: { ...existing.progressPayload, ...change } }, caller)).toBe(false);
  expect(mocks.reserve).not.toHaveBeenCalled();
});
it("does not turn actual pre-expiry revocation into expiry recovery", async () => {
  mocks.token.mockResolvedValue({ userId: "human", oauthFamilyKey: "family", expiresAt: new Date(3000) });
  expect(await recoverExpiredOAuthReview(existing, caller)).toBe(false);
  expect(mocks.reserve).not.toHaveBeenCalled();
});
it("refuses another human", async () => {
  expect(await recoverExpiredOAuthReview(existing, { ...caller, userId: "other" })).toBe(false);
  expect(mocks.reserve).not.toHaveBeenCalled();
});
it("refuses a different family", async () => {
  mocks.token.mockResolvedValue({ userId: "human", oauthFamilyKey: "other", expiresAt: new Date(1000) });
  expect(await recoverExpiredOAuthReview(existing, caller)).toBe(false);
  expect(mocks.reserve).not.toHaveBeenCalled();
});
