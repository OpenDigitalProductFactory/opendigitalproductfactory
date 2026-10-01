import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@dpf/db", () => ({ prisma: {} }));
import { loadApprovalOutcomes, readApprovalOutcome, recordApprovalOutcome } from "./approval-outcome-store";

const now = new Date("2026-09-27T12:00:00Z");
const row = { id: "e1", delegatingUserId: "u1", coworkerAgentId: "a1", threadId: "thread1", taskRunId: null, status: "approved", createdAt: now, expiresAt: now, toolExecutions: [] as unknown[] };
function fixture() {
  const findFirst = vi.fn(async ({ where }: { where: Record<string, unknown> }) => where.delegatingUserId === "u1" && (!where.coworkerAgentId || where.coworkerAgentId === "a1") ? row : null);
  const create = vi.fn(async ({ data }: { data: unknown }) => { row.toolExecutions = [data]; return data; });
  const findMany = vi.fn(async (_args: unknown) => [row]);
  return { coworkerActionEnvelope: { findFirst, findMany }, toolExecution: { create } };
}
describe("approval receipt owner and assistant isolation", () => {
  it("records not-run then reads the result in a new request without transient UI state", async () => {
    const db = fixture();
    await recordApprovalOutcome("e1", "u1", { status: "not-run", reason: "credential-unavailable", message: "private raw details" }, db as never);
    const result = await readApprovalOutcome("e1", "u1", "a1", db as never, now);
    expect(result?.state).toBe("not-run");
    expect(result?.nextAction).toContain("connection");
    expect(JSON.stringify(db.toolExecution.create.mock.calls)).not.toContain("private raw details");
    expect(db.toolExecution.create.mock.calls[0][0]).toMatchObject({ data: { toolName: "approval_outcome", envelopeId: "e1" } });
  });
  it.each([["u2", "a1"], ["u1", "a2"]])("denies %s/%s without revealing the request", async (user, agent) => {
    expect(await readApprovalOutcome("e1", user, agent, fixture() as never, now)).toBeNull();
  });
  it("does not query without the verified assistant identity", async () => {
    const db = fixture();
    expect(await readApprovalOutcome("e1", "u1", undefined, db as never, now)).toBeNull();
    expect(db.coworkerActionEnvelope.findFirst).not.toHaveBeenCalled();
  });
  it("keeps the owner predicate on history and old exact links", async () => {
    const db = fixture();
    await loadApprovalOutcomes("u1", undefined, db as never, now);
    expect(db.coworkerActionEnvelope.findMany.mock.calls[0][0]).toMatchObject({ where: { delegatingUserId: "u1", OR: expect.any(Array) }, take: 10 });
    await loadApprovalOutcomes("u1", "e1", db as never, now);
    expect(db.coworkerActionEnvelope.findMany.mock.calls[1][0]).toMatchObject({ where: { delegatingUserId: "u1", id: "e1" }, take: 1 });
  });
  it("cannot attach a receipt to another person's request", async () => {
    const db = fixture();
    await expect(recordApprovalOutcome("e1", "u2", { status: "executed", message: "Done" }, db as never)).rejects.toThrow();
    expect(db.toolExecution.create).not.toHaveBeenCalled();
  });
});
