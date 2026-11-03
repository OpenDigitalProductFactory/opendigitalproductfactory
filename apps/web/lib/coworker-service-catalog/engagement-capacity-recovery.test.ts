import { beforeEach, expect, it, vi } from "vitest";
const deps = vi.hoisted(() => ({ load: vi.fn(), reconstruct: vi.fn(), namespace: vi.fn(), validate: vi.fn(), reconcile: vi.fn() }));
vi.mock("@/lib/mcp-task-persisted-request", () => ({ loadPersistedRemoteTask: deps.load, reconstructPersistedRemoteTask: deps.reconstruct }));
vi.mock("@/lib/auth/oauth-task-authority", () => ({ resolveMcpTaskAuthorityKey: deps.namespace }));
vi.mock("./engagement-fulfillment", () => ({ validateEngagementTask: deps.validate }));
vi.mock("@/lib/mcp-task-background-dispatch", () => ({ reconcilePersistedRemoteTaskDispatches: deps.reconcile }));
import { resumeCapacityWaitingEngagementTask } from "./engagement-capacity-recovery";
const binding = { version: 1, engagementId: "CE-ORIGINAL", artifactRef: { commitSha: "f52-original" } };
const input = { taskRunId: "TR-ORIGINAL", binding, token: { tokenId: "current", userId: "user", source: "oauth", capability: "write" } } as never;
let task: any;
beforeEach(() => {
  vi.clearAllMocks();
  task = { taskRunId: "TR-ORIGINAL", userId: "user", status: "submitted", a2aMetadata: { taskAuthorityKey: "oauth-family:original" }, progressPayload: { executedToolCount: 0, resourceWait: { schemaVersion: 1, kind: "provider-capacity", resumeMode: "same-taskrun", failureKind: "busy", attempt: 1, observedAt: "2026-10-25T00:00:00Z", nextAttemptAt: "2026-10-25T00:01:00Z" } } };
  deps.load.mockImplementation(async () => task);
  deps.reconstruct.mockImplementation(() => ({ ok: true, data: { token: { tokenId: "origin", userId: "user", source: "oauth", capability: "write" }, parsed: { engagementBinding: binding, objective: "Original", prompt: "Original full packet", authorityScope: ["file_read"] } } }));
  deps.namespace.mockResolvedValue("oauth-family:original");
  deps.validate.mockResolvedValue({ engagement: { metadata: {} } });
  deps.reconcile.mockResolvedValue({ scanned: 1, enqueued: 1, exhausted: 0, raced: 0 });
});
it("validates both authorities and wakes only the original task through its bounded outbox", async () => {
  expect(await resumeCapacityWaitingEngagementTask(input)).toBe(true);
  expect(deps.validate.mock.calls.map(([arg]) => arg.token.tokenId)).toEqual(["current", "origin"]);
  expect(deps.validate.mock.calls[0][0]).toMatchObject({ binding, requireAssociation: true, request: { objective: "Original", prompt: "Original full packet" } });
  expect(deps.reconcile).toHaveBeenCalledExactlyOnceWith({ taskRunId: "TR-ORIGINAL", includeOrdinary: false });
});
it.each(["working", "failed", "completed", "input-required"])("observes %s without requesting another execution", async status => {
  task.status = status;
  expect(await resumeCapacityWaitingEngagementTask(input)).toBe(false);
  expect(deps.reconcile).not.toHaveBeenCalled();
});
it("waits out backoff and refuses exhausted or uncertain execution", async () => {
  for (const change of [ { resourceWait: { ...task.progressPayload.resourceWait, nextAttemptAt: "2099-01-01T00:00:00Z" } }, { resourceWait: { ...task.progressPayload.resourceWait, attempt: 5 } }, { executionUncertainty: { schemaVersion: 1, outcome: "unknown" } }, { executedToolCount: 1 } ]) {
    const prior = task.progressPayload; task.progressPayload = { ...prior, ...change };
    expect(await resumeCapacityWaitingEngagementTask(input)).toBe(false);
    task.progressPayload = prior;
  }
  expect(deps.reconcile).not.toHaveBeenCalled();
});
it("refuses changed immutable scope, consent family and revoked authority", async () => {
  deps.reconstruct.mockReturnValueOnce({ ok: true, data: { parsed: { engagementBinding: { ...binding, engagementId: "CE-OTHER" } } } });
  await expect(resumeCapacityWaitingEngagementTask(input)).rejects.toThrow(/packet/);
  deps.namespace.mockResolvedValueOnce("oauth-family:other");
  await expect(resumeCapacityWaitingEngagementTask(input)).rejects.toThrow(/family/);
  deps.validate.mockRejectedValueOnce(new Error("authorization_revoked"));
  await expect(resumeCapacityWaitingEngagementTask(input)).rejects.toThrow(/revoked/);
  expect(deps.reconcile).not.toHaveBeenCalled();
});
it("does not claim a concurrent or pending outbox wake was dispatched again", async () => {
  deps.reconcile.mockResolvedValue({ scanned: 0, enqueued: 0, exhausted: 0, raced: 0 });
  expect(await resumeCapacityWaitingEngagementTask(input)).toBe(false);
});
