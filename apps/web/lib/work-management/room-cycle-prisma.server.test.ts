import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ cycles: vi.fn(), messages: vi.fn(), lock: vi.fn(), find: vi.fn(), outcome: vi.fn() }));
vi.mock("@dpf/db", () => ({
  Prisma: { sql: vi.fn() },
  prisma: { $transaction: (callback: (tx: unknown) => unknown) => callback({
    $queryRaw: mocks.lock,
    workItem: { findMany: mocks.cycles, findFirst: mocks.find },
    workItemMessage: { findMany: mocks.messages, findFirst: mocks.outcome },
  }) },
}));
import { prismaWorkroomCycleDb } from "./room-cycle-prisma.server";

beforeEach(() => vi.resetAllMocks());
describe("cycle persistence bounded history", () => {
  it("reuses an exact outcome without scanning an older message history", async () => {
    const row = { messageId: "receipt", structuredPayload: { kind: "work-room-outcome-packet", version: 1,
      cycleKey: "week", carrierId: "WI-1", packet: { summary: "done", accountablePrincipalRef: "owner", completedAt: "2026-10-07T12:00:00Z", sourceRefs: [], unresolvedWork: [] } } };
    mocks.outcome.mockResolvedValue(row);
    const result = await prismaWorkroomCycleDb.withinRoomLock("room-a", tx => tx.findOutcome("room-a", "week", "WI-1"));
    expect(result).toEqual(row);
    expect(mocks.outcome.mock.calls[0]![0].where).toMatchObject({ workItemId: "room-a", messageType: "work-room-outcome-packet" });
    expect(mocks.messages).not.toHaveBeenCalled();
  });
  it("refuses a source identity whose stored cycle boundary disagrees", async () => {
    mocks.find.mockResolvedValue({ id: "row", evidence: { workroomCycle: { version: 999 } } });
    await expect(prismaWorkroomCycleDb.withinRoomLock("room-a", tx =>
      tx.findCycle("room-a", { cycleKey: "requested" }))).rejects.toThrow("Cycle identity does not match its stored boundary");
    expect(mocks.cycles).not.toHaveBeenCalled();
  });
  it("refuses an outcome identity bound to another carrier", async () => {
    mocks.outcome.mockResolvedValue({ structuredPayload: { kind: "work-room-outcome-packet", version: 1,
      cycleKey: "week", carrierId: "WI-foreign", packet: { summary: "done", accountablePrincipalRef: "owner", completedAt: "2026-10-07T12:00:00Z", sourceRefs: [], unresolvedWork: [] } } });
    await expect(prismaWorkroomCycleDb.withinRoomLock("room-a", tx =>
      tx.findOutcome("room-a", "week", "WI-1"))).rejects.toThrow("Outcome identity does not match");
    expect(mocks.messages).not.toHaveBeenCalled();
  });
  it("limits the legacy outcome fallback to the room's completion packets", async () => {
    mocks.outcome.mockResolvedValue(null);
    mocks.messages.mockResolvedValue([]);
    expect(await prismaWorkroomCycleDb.withinRoomLock("room-a", tx =>
      tx.findOutcome("room-a", "week", "WI-1"))).toBeNull();
    expect(mocks.messages).toHaveBeenCalledWith(expect.objectContaining({
      where: { workItemId: "room-a", messageType: "work-room-outcome-packet" }, take: 200,
    }));
  });
  it("locates an exact carrier within its parent without scanning history", async () => {
    const row = { id: "row", itemId: "WI-1" };
    mocks.find.mockResolvedValue(row);
    const result = await prismaWorkroomCycleDb.withinRoomLock("room-a", tx => tx.findCycle("room-a", { carrierId: "WI-1" }));
    expect(result).toEqual(row);
    expect(mocks.find).toHaveBeenCalledWith(expect.objectContaining({ where: { parentItemId: "room-a", itemId: "WI-1" } }));
    expect(mocks.cycles).not.toHaveBeenCalled();
  });
  it.each(["cycles", "messages"] as const)("reads all %s across pages while retaining the room filter", async (kind) => {
    const first = Array.from({ length: 200 }, (_, n) => ({
      id: `row-${String(n).padStart(4, "0")}`, createdAt: new Date("2026-10-07T12:00:00Z"),
    }));
    const last = { id: "row-0200", createdAt: first[0]!.createdAt };
    mocks[kind].mockResolvedValueOnce(first).mockResolvedValueOnce([last]);
    const result = await prismaWorkroomCycleDb.withinRoomLock<unknown[]>("room-a", tx =>
      kind === "cycles" ? tx.listCycles("room-a") : tx.listMessages("room-a"));
    expect(result).toHaveLength(201);
    expect(mocks[kind]).toHaveBeenCalledTimes(2);
    for (const [query] of mocks[kind].mock.calls) {
      expect(query.take).toBeLessThanOrEqual(200);
      expect(query.where).toMatchObject(kind === "cycles" ? { parentItemId: "room-a" } : { workItemId: "room-a" });
    }
    expect(mocks[kind].mock.calls[1]![0].where.OR).toContainEqual({ createdAt: last.createdAt, id: { gt: "row-0199" } });
  });
});
