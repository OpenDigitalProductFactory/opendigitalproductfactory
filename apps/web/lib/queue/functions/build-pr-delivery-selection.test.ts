import { describe, expect, it, vi } from "vitest";
import { createBuildPrDeliveryState } from "@/lib/build/build-pr-delivery-state";
import { getCatalogEntry } from "@/lib/operate/scheduled-jobs/catalog";
import { selectPrDeliveryRooms } from "./build-pr-delivery-selection";

type Db = Parameters<typeof selectPrDeliveryRooms>[0];
function fixture(count: number, initialCursor: string | null = null) {
  const rows = Array.from({ length: count }, (_, i) => ({
    id: `row-${String(i).padStart(4, "0")}`,
    workspaceState: {} as Record<string, unknown>,
  }));
  const job = { id: "job-row", runCursor: initialCursor, enabled: true, updatedAt: new Date(0) };
  const upsert = vi.fn(async (_args: unknown) => ({ ...job }));
  const findMany = vi.fn(async (args: { where: { id?: { gt: string } }; take: number }) =>
    rows.filter(row => !args.where.id || row.id > args.where.id.gt).slice(0, args.take));
  const updateMany = vi.fn(async (args: { where: typeof job; data: { runCursor: string | null } }) => {
    if (!job.enabled || args.where.runCursor !== job.runCursor
      || args.where.updatedAt.getTime() !== job.updatedAt.getTime()) return { count: 0 };
    job.runCursor = args.data.runCursor;
    job.updatedAt = new Date(job.updatedAt.getTime() + 1);
    return { count: 1 };
  });
  const db = { scheduledJob: { upsert, updateMany }, workroom: { findMany } } as unknown as Db;
  return { rows, job, upsert, updateMany, findMany, db };
}
function state(status: "closed" | "deployed" | "escalated" | "checking") {
  return { ...createBuildPrDeliveryState({ repository: "o/r", prNumber: 1, prUrl: "https://github.com/o/r/pull/1" }), status };
}

describe("bounded PR delivery cursor selection", () => {
  it("uses the existing catalogued job and does not replace its persisted controls or metadata", async () => {
    const f = fixture(1);
    await selectPrDeliveryRooms(f.db);
    const definition = getCatalogEntry("build-pr-delivery-reconcile")!;
    expect(f.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { jobId: definition.jobId }, update: {},
      create: { jobId: definition.jobId, name: definition.name, schedule: definition.cron, category: definition.category, locked: true },
    }));
    expect(f.findMany.mock.calls[0]?.[0]).toMatchObject({
      take: 200, orderBy: { id: "asc" },
      where: { pullRequestNumber: { not: null }, pullRequestUrl: { not: null }, status: { notIn: ["complete", "abandoned", "archived"] } },
    });
    expect(Object.keys(f.updateMany.mock.calls[0]![0].data)).toEqual(["runCursor"]);
  });

  it("does not skip unconsumed rows after reaching the 25-room cap and resumes after restart", async () => {
    const f = fixture(61);
    expect((await selectPrDeliveryRooms(f.db)).map(row => row.id)).toEqual(f.rows.slice(0, 25).map(row => row.id));
    expect(f.job.runCursor).toBe("row-0024");
    // A fresh caller uses persisted state; no process-local cursor survives here.
    const restarted = { scheduledJob: f.db.scheduledJob, workroom: f.db.workroom };
    expect((await selectPrDeliveryRooms(restarted)).map(row => row.id)).toEqual(f.rows.slice(25, 50).map(row => row.id));
    expect((await selectPrDeliveryRooms(restarted)).map(row => row.id)).toEqual(f.rows.slice(50).map(row => row.id));
  });

  it("advances through a stopped prefix larger than the scan window", async () => {
    const f = fixture(223);
    for (const row of f.rows.slice(0, 220)) row.workspaceState = { prDelivery: state("deployed") };
    expect(await selectPrDeliveryRooms(f.db)).toEqual([]);
    expect(f.job.runCursor).toBe("row-0199");
    expect((await selectPrDeliveryRooms(f.db)).map(row => row.id)).toEqual(["row-0220", "row-0221", "row-0222"]);
    expect(f.findMany.mock.calls.every(([args]) => args.take === 200)).toBe(true);
  });

  it("uses the existing current/legacy parser and keeps malformed stopped-looking states eligible", async () => {
    const f = fixture(5);
    f.rows[0]!.workspaceState = { buildStudio: { delivery: state("closed") } };
    f.rows[1]!.workspaceState = { prDelivery: state("escalated") };
    f.rows[2]!.workspaceState = { prDelivery: { status: "deployed" } };
    f.rows[3]!.workspaceState = { buildStudio: { delivery: state("checking") } };
    expect((await selectPrDeliveryRooms(f.db)).map(row => row.id)).toEqual(["row-0002", "row-0003", "row-0004"]);
    expect(f.job.runCursor).toBe("row-0004");
  });

  it("wraps once after a deleted cursor and eventually includes newly inserted earlier IDs", async () => {
    const f = fixture(3, "row-9999");
    expect((await selectPrDeliveryRooms(f.db)).length).toBe(3);
    expect(f.findMany).toHaveBeenCalledTimes(2);
    expect(f.findMany.mock.calls[0]?.[0].where.id).toEqual({ gt: "row-9999" });
    expect(f.findMany.mock.calls[1]?.[0].where).not.toHaveProperty("id");
    f.rows.unshift({ id: "row-0000-earlier", workspaceState: {} });
    expect((await selectPrDeliveryRooms(f.db)).some(row => row.id === "row-0000-earlier")).toBe(true);
  });

  it("returns no effectful batch when a concurrent cursor claim wins", async () => {
    const f = fixture(30);
    f.updateMany.mockResolvedValue({ count: 0 });
    expect(await selectPrDeliveryRooms(f.db)).toEqual([]);
    expect(f.job.runCursor).toBeNull();
    expect(f.updateMany.mock.calls[0]?.[0].where).toMatchObject({ runCursor: null, updatedAt: new Date(0), enabled: true });
  });

  it("rejects an ABA version change even when the cursor string has returned to its old value", async () => {
    const f = fixture(2);
    f.findMany.mockImplementationOnce(async () => {
      f.job.updatedAt = new Date(10);
      return f.rows;
    });
    expect(await selectPrDeliveryRooms(f.db)).toEqual([]);
    expect(f.job.runCursor).toBeNull();
  });

  it("fails before returning a batch if its durable cursor write fails", async () => {
    const f = fixture(30);
    f.updateMany.mockRejectedValue(new Error("database unavailable"));
    await expect(selectPrDeliveryRooms(f.db)).rejects.toThrow("database unavailable");
  });

  it("honors an existing disabled job without changing its controls or scanning rooms", async () => {
    const f = fixture(1);
    f.job.enabled = false;
    expect(await selectPrDeliveryRooms(f.db)).toEqual([]);
    expect(f.upsert.mock.calls[0]![0]).toMatchObject({ update: {} });
    expect(f.findMany).not.toHaveBeenCalled();
    expect(f.updateMany).not.toHaveBeenCalled();
  });

  it("resets an empty scan without inventing a room or advancing a room head", async () => {
    const f = fixture(0, "deleted-row");
    expect(await selectPrDeliveryRooms(f.db)).toEqual([]);
    expect(f.job.runCursor).toBeNull();
    expect(f.findMany).toHaveBeenCalledTimes(2);
  });
});
