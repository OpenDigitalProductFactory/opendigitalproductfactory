import { describe, it, expect, vi } from "vitest";
import {
  columnForStatus,
  groupDispatchJobs,
  getDispatchBoard,
  type DispatchJobView,
} from "./dispatch-board-data";

function job(over: Partial<DispatchJobView> = {}): DispatchJobView {
  return {
    itemId: "WI-1",
    title: "AC Repair — Dana",
    status: "queued",
    urgency: "routine",
    dueAt: "2026-07-08T14:00:00.000Z",
    createdAt: "2026-07-06T12:00:00.000Z",
    ...over,
  };
}

describe("columnForStatus", () => {
  it("maps known statuses to columns", () => {
    expect(columnForStatus("queued")).toBe("queued");
    expect(columnForStatus("assigned")).toBe("assigned");
    expect(columnForStatus("awaiting-approval")).toBe("awaiting-input");
    expect(columnForStatus("completed")).toBe("completed");
  });
  it("folds unknown/active statuses into in-progress", () => {
    expect(columnForStatus("escalated")).toBe("in-progress");
    expect(columnForStatus("in-progress")).toBe("in-progress");
  });
});

describe("groupDispatchJobs", () => {
  it("places jobs in their columns and preserves all five columns", () => {
    const board = groupDispatchJobs([
      job({ itemId: "a", status: "queued" }),
      job({ itemId: "b", status: "assigned" }),
      job({ itemId: "c", status: "assigned" }),
      job({ itemId: "d", status: "completed" }),
    ]);
    expect(board.total).toBe(4);
    expect(board.columns.map((c) => c.key)).toEqual([
      "queued",
      "assigned",
      "in-progress",
      "awaiting-input",
      "completed",
    ]);
    const assigned = board.columns.find((c) => c.key === "assigned")!;
    expect(assigned.jobs.map((j) => j.itemId)).toEqual(["b", "c"]);
    expect(board.columns.find((c) => c.key === "in-progress")!.jobs).toHaveLength(0);
  });

  it("returns empty columns for no jobs", () => {
    const board = groupDispatchJobs([]);
    expect(board.total).toBe(0);
    expect(board.columns).toHaveLength(5);
    expect(board.columns.every((c) => c.jobs.length === 0)).toBe(true);
  });
});

describe("getDispatchBoard", () => {
  it("queries the storefront's dispatch queue for field-service jobs", async () => {
    const findMany = vi.fn(async (_args: { where: Record<string, unknown> }) => [
      { itemId: "WI-1", title: "AC Repair", status: "queued", urgency: "routine", dueAt: new Date("2026-07-08T14:00:00Z"), createdAt: new Date("2026-07-06T12:00:00Z") },
    ]);
    const board = await getDispatchBoard("sf-1", { getFinder: async () => ({ findMany }) });
    expect(board.total).toBe(1);
    const where = findMany.mock.calls[0]![0].where;
    expect(where.sourceType).toBe("field-service-job");
    expect(where.queue).toEqual({ is: { queueId: "dispatch-sf-1" } });
    expect(board.columns.find((c) => c.key === "queued")!.jobs[0]!.dueAt).toBe(
      "2026-07-08T14:00:00.000Z",
    );
  });

  it("returns an empty board on read failure (never throws)", async () => {
    const board = await getDispatchBoard("sf-1", {
      getFinder: async () => ({ findMany: async () => { throw new Error("db down"); } }),
    });
    expect(board.total).toBe(0);
  });
});
