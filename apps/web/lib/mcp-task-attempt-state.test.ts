import { beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), project: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { taskRun: { findUnique: db.read, updateMany: db.write } } }));
vi.mock("./coworker-service-catalog/engagement-fulfillment", () => ({ reconcileEngagementTaskResult: db.project }));
import { settleRemoteTask } from "./mcp-task-attempt-state";
beforeEach(() => { vi.clearAllMocks(); db.write.mockResolvedValue({ count: 1 }); db.project.mockResolvedValue(undefined); });
it.each(["submitted", "completed", "failed", "input-required"])("retains server-owned continuation history across %s settlement", async status => {
  const audit = { schemaVersion: 1, requestDigest: "original", priorProgress: { errorCode: "request_digest_mismatch" } };
  db.read.mockResolvedValue({ status: "working", updatedAt: new Date(), a2aMetadata: { engagementBinding: { engagementId: "CE-ORIGINAL" } }, progressPayload: { engagementPreAdmissionContinuation: audit, dispatch: { claimedAt: "claim" } } });
  await settleRemoteTask({ where: { taskRunId: "TR-ORIGINAL" }, data: { status, progressPayload: { summary: "Current result", engagementPreAdmissionContinuation: { forged: true } } } }, null, "claim");
  expect(db.write.mock.calls[0][0].data.progressPayload).toMatchObject({ summary: "Current result", engagementPreAdmissionContinuation: audit, dispatch: { claimedAt: "claim" } });
});
it("never writes continuation history after cancellation", async () => {
  db.read.mockResolvedValue({ status: "canceled", progressPayload: {} });
  await settleRemoteTask({ where: { taskRunId: "TR-ORIGINAL" }, data: { status: "completed", progressPayload: { summary: "late" } } }, null, null);
  expect(db.write).not.toHaveBeenCalled();
});
