import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("./execute-coordinator-appointment.server", () => ({ executeCoordinatorAppointment: execute }));
const resolveWorkOwner = vi.hoisted(() => vi.fn());
vi.mock("@/lib/portfolio/accountable-owner", () => ({ resolveWorkOwner }));

import { applyAccountHandover, handoverDigest, planAccountHandover, type AccountHandoverDb } from "./account-handover";

const ADMIN = { userId: "u-admin", principalRowId: "p-admin", principalRef: "PRN-admin" };
const MARK = { userId: "u-mark", principalRowId: "p-mark", principalRef: "PRN-mark", displayName: "Mark" };

function fakeDb(overrides: Partial<{ rooms: unknown[]; builds: unknown[]; tasks: unknown[] }> = {}) {
  const db = {
    user: { findFirst: vi.fn(async ({ where }: { where: { OR: Array<{ id?: string; email?: string }> } }) =>
      where.OR.some((o) => o.id === ADMIN.userId || o.email === "admin@dpf.local") ? { id: ADMIN.userId, email: "admin@dpf.local" } : null) },
    principalAlias: { findFirst: vi.fn(async ({ where }: { where: { aliasValue: string } }) =>
      where.aliasValue === ADMIN.userId ? { principal: { id: ADMIN.principalRowId, principalId: ADMIN.principalRef } }
        : where.aliasValue === MARK.userId ? { principal: { id: MARK.principalRowId, principalId: MARK.principalRef } } : null) },
    portfolio: { findMany: vi.fn(async () => [{ id: "pf-found", slug: "foundational" }, { id: "pf-sold", slug: "products_and_services_sold" }]) },
    workroom: { findMany: vi.fn(async () => overrides.rooms ?? [
      { id: "r1", capsuleId: "WC-1", portfolioRole: "foundational", participants: [{ principalId: ADMIN.principalRowId }] },
      // Someone else also coordinates this room: not the absent account's alone, so untouched.
      { id: "r2", capsuleId: "WC-2", portfolioRole: "foundational", participants: [{ principalId: ADMIN.principalRowId }, { principalId: "p-other" }] },
    ]) },
    featureBuild: {
      findMany: vi.fn(async () => overrides.builds ?? [{ id: "b1", buildId: "FB-1", portfolioId: "pf-sold" }]),
      update: vi.fn(async () => ({})),
    },
    buildActivity: { create: vi.fn(async () => ({})) },
    agent: { findMany: vi.fn(async () => [{ agentId: "AGT-1", portfolioId: "pf-found" }]) },
    scheduledAgentTask: {
      // Like Prisma: ScheduledAgentTask has no `agent` relation, only the agentId string.
      findMany: vi.fn(async ({ select }: { select: Record<string, unknown> }) => {
        if ("agent" in select) throw new Error("Unknown field `agent` for select statement on model `ScheduledAgentTask`.");
        return overrides.tasks ?? [{ id: "t1", taskId: "task-1", agentId: "AGT-1" }];
      }),
      update: vi.fn(async () => ({})),
    },
  };
  return db as unknown as AccountHandoverDb & typeof db;
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveWorkOwner.mockResolvedValue({ userId: MARK.userId, source: "portfolio" });
  execute.mockResolvedValue({ ok: true, data: { capsuleId: "WC-1", principalRef: MARK.principalRef, displayName: "Mark" } });
});

// BI-F25A5FC7: an account nobody uses still owned live rooms, builds and
// scheduled tasks. One approval hands all of it to the portfolio's person.
describe("planAccountHandover", () => {
  it("lists the account's live rooms, builds and scheduled tasks with the new owner of each", async () => {
    const plan = await planAccountHandover(fakeDb(), { sourceAccount: "admin@dpf.local" });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.data.items.map((i) => [i.kind, i.ref, i.toUserId])).toEqual([
      ["build", "FB-1", "u-mark"],
      ["room", "WC-1", "u-mark"],
      ["scheduled-task", "task-1", "u-mark"],
    ]);
    expect(plan.data.digest).toBe(handoverDigest(plan.data.items, "u-admin"));
  });

  it("finds a scheduled task's portfolio through its agent", async () => {
    await planAccountHandover(fakeDb(), { sourceAccount: "admin@dpf.local" });
    expect(resolveWorkOwner.mock.calls.map((c) => c[1].portfolioId)).toEqual(["pf-sold", "pf-found", "pf-found"]);
  });

  it("leaves a room that someone else also coordinates", async () => {
    const plan = await planAccountHandover(fakeDb(), { sourceAccount: "admin@dpf.local" });
    expect(plan.ok && plan.data.items.some((i) => i.ref === "WC-2")).toBe(false);
  });

  it("refuses an item whose owner would only be the guessed fallback, or the source itself", async () => {
    resolveWorkOwner
      .mockResolvedValueOnce({ userId: "u-guess", source: "fallback" })
      .mockResolvedValueOnce({ userId: "u-admin", source: "organization" })
      .mockResolvedValue({ userId: MARK.userId, source: "portfolio" });
    const plan = await planAccountHandover(fakeDb(), { sourceAccount: "admin@dpf.local" });
    if (!plan.ok) throw new Error("expected a plan");
    expect(plan.data.refused.map((r) => r.reason)).toEqual([
      expect.stringMatching(/nobody has been chosen/i),
      expect.stringMatching(/already/i),
    ]);
    expect(plan.data.items).toHaveLength(1);
  });

  it("refuses an unknown account", async () => {
    const plan = await planAccountHandover(fakeDb(), { sourceAccount: "nobody@example.com" });
    expect(plan).toMatchObject({ ok: false });
  });
});

describe("handoverDigest", () => {
  it("does not depend on the order the items were read in", () => {
    const a = { kind: "room" as const, id: "r1", ref: "WC-1", toUserId: "u", toPrincipalRef: "PRN-u", source: "portfolio" as const };
    const b = { kind: "build" as const, id: "b1", ref: "FB-1", toUserId: "u", toPrincipalRef: "PRN-u", source: "portfolio" as const };
    expect(handoverDigest([a, b], "s")).toBe(handoverDigest([b, a], "s"));
    expect(handoverDigest([a], "s")).not.toBe(handoverDigest([a, b], "s"));
  });
});

describe("applyAccountHandover", () => {
  const actor = { userId: "u-mark" };

  it("refuses when the work changed since the dry run, and writes nothing", async () => {
    const result = await applyAccountHandover(fakeDb(), { sourceAccount: "admin@dpf.local", digest: "stale", reason: "r", actor });
    expect(result).toMatchObject({ ok: false });
    expect(execute).not.toHaveBeenCalled();
  });

  it("re-homes every planned item under the approving person and reports counts", async () => {
    const db = fakeDb();
    const plan = await planAccountHandover(db, { sourceAccount: "admin@dpf.local" });
    if (!plan.ok) throw new Error("expected a plan");
    const result = await applyAccountHandover(db, { sourceAccount: "admin@dpf.local", digest: plan.data.digest, reason: "Absent account", actor });
    expect(result).toEqual({ ok: true, data: { rooms: 1, builds: 1, scheduledTasks: 1, failed: [] } });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ capsuleId: "WC-1", principalRef: "PRN-mark", replaceExisting: true }));
    expect(db.featureBuild.update).toHaveBeenCalledWith({ where: { id: "b1" }, data: { createdById: "u-mark" } });
    expect(db.buildActivity.create).toHaveBeenCalledWith({ data: expect.objectContaining({ buildId: "FB-1", tool: "apply_account_handover" }) });
    expect(db.scheduledAgentTask.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: { ownerUserId: "u-mark" } });
  });

  it("reports a room that could not be re-homed and carries on with the rest", async () => {
    execute.mockResolvedValue({ ok: false, error: "assignment_failed: no" });
    const db = fakeDb();
    const plan = await planAccountHandover(db, { sourceAccount: "admin@dpf.local" });
    if (!plan.ok) throw new Error("expected a plan");
    const result = await applyAccountHandover(db, { sourceAccount: "admin@dpf.local", digest: plan.data.digest, reason: "r", actor });
    expect(result).toMatchObject({ ok: true, data: { rooms: 0, builds: 1, scheduledTasks: 1, failed: [{ ref: "WC-1" }] } });
  });
});
