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
    status: "scheduled",
    statusLabel: "Scheduled",
    urgency: "routine",
    dueAt: "2026-07-08T14:00:00.000Z",
    createdAt: "2026-07-06T12:00:00.000Z",
    assigned: false,
    assignmentLabel: "Needs assignment",
    partsUsed: 0,
    attentionReasons: ["Scheduled but not confirmed", "Needs assignment"],
    ...over,
  };
}

describe("columnForStatus", () => {
  it("maps known statuses to columns", () => {
    expect(columnForStatus("queued")).toBe("needs-dispatch");
    expect(columnForStatus("quoted")).toBe("needs-dispatch");
    expect(columnForStatus("scheduled")).toBe("needs-dispatch");
    expect(columnForStatus("confirmed")).toBe("ready");
    expect(columnForStatus("en-route")).toBe("active");
    expect(columnForStatus("complete")).toBe("complete");
    expect(columnForStatus("paid")).toBe("settled");
  });
  it("folds unknown statuses into needs-dispatch through the field-dispatch contract", () => {
    expect(columnForStatus("escalated")).toBe("needs-dispatch");
    expect(columnForStatus("in-progress")).toBe("needs-dispatch");
  });
});

describe("groupDispatchJobs", () => {
  it("places jobs in operational lanes and preserves all five lanes", () => {
    const board = groupDispatchJobs([
      job({ itemId: "a", status: "needs-review", attentionReasons: ["No valid dispatch state"] }),
      job({ itemId: "b", status: "confirmed", statusLabel: "Confirmed", assigned: true, assignmentLabel: "Assigned" }),
      job({ itemId: "c", status: "en-route", statusLabel: "En route", assigned: true, assignmentLabel: "Assigned" }),
      job({ itemId: "d", status: "complete", statusLabel: "Complete", assigned: true, assignmentLabel: "Assigned", attentionReasons: [] }),
    ]);
    expect(board.total).toBe(4);
    expect(board.columns.map((c) => c.key)).toEqual([
      "needs-dispatch",
      "ready",
      "active",
      "complete",
      "settled",
    ]);
    expect(board.columns.find((c) => c.key === "ready")!.jobs.map((j) => j.itemId)).toEqual(["b"]);
    expect(board.columns.find((c) => c.key === "active")!.jobs.map((j) => j.itemId)).toEqual(["c"]);
    expect(board.columns.find((c) => c.key === "settled")!.jobs).toHaveLength(0);
  });

  it("returns empty operational context for no jobs", () => {
    const board = groupDispatchJobs([]);
    expect(board.total).toBe(0);
    expect(board.columns).toHaveLength(5);
    expect(board.columns.every((c) => c.jobs.length === 0)).toBe(true);
    expect(board.summary).toMatchObject({
      needsAttention: 0,
      unassigned: 0,
      active: 0,
      readyToInvoice: 0,
      partsUsed: 0,
    });
    expect(board.nextJob).toBeNull();
  });

  it("summarizes attention, assignment, active work, route stops, and support signals", () => {
    const board = groupDispatchJobs([
      job({ itemId: "a", status: "scheduled", dueAt: "2026-07-08T14:00:00.000Z", attentionReasons: ["Scheduled but not confirmed", "Needs assignment"] }),
      job({ itemId: "b", status: "confirmed", statusLabel: "Confirmed", dueAt: "2026-07-08T16:00:00.000Z", assigned: false, attentionReasons: ["Needs assignment"] }),
      job({ itemId: "c", status: "en-route", statusLabel: "En route", dueAt: "2026-07-08T13:00:00.000Z", assigned: true, assignmentLabel: "Assigned", attentionReasons: [] }),
      job({ itemId: "d", status: "complete", statusLabel: "Complete", dueAt: "2026-07-08T17:00:00.000Z", assigned: true, assignmentLabel: "Assigned", partsUsed: 3, attentionReasons: [] }),
      job({ itemId: "e", status: "paid", statusLabel: "Paid", dueAt: "2026-07-08T12:00:00.000Z", assigned: true, assignmentLabel: "Assigned", attentionReasons: [] }),
    ]);

    expect(board.summary).toMatchObject({
      needsAttention: 2,
      unassigned: 2,
      active: 1,
      readyToInvoice: 1,
      partsUsed: 3,
    });
    expect(board.nextJob?.itemId).toBe("c");
    expect(board.routeStops.map((stop) => stop.itemId)).toEqual(["c", "a", "b", "d"]);
  });
});

describe("getDispatchBoard", () => {
  it("queries the storefront's dispatch queue for field-service jobs", async () => {
    const findMany = vi.fn(async (_args: { where: Record<string, unknown>; select?: unknown }) => [
      {
        itemId: "WI-1",
        title: "AC Repair",
        status: "queued",
        urgency: "routine",
        dueAt: new Date("2026-07-08T14:00:00Z"),
        createdAt: new Date("2026-07-06T12:00:00Z"),
        assignedToUserId: null,
        assignedToAgentId: null,
        evidence: {
          entries: [{
            kind: "parts-used",
            at: "2026-07-08T15:00:00.000Z",
            partsUsed: [{ sku: "FILTER", quantity: 2 }],
          }],
        },
      },
    ]);
    const board = await getDispatchBoard("sf-1", { getFinder: async () => ({ findMany }) });
    expect(board.total).toBe(1);
    const args = findMany.mock.calls[0]![0];
    expect(args.where.sourceType).toBe("field-service-job");
    expect(args.where.queue).toEqual({ is: { queueId: "dispatch-sf-1" } });
    expect(args.select).toMatchObject({ status: true, evidence: true, assignedToUserId: true });
    const queuedJob = board.columns.find((c) => c.key === "needs-dispatch")!.jobs[0]!;
    expect(queuedJob.status).toBe("needs-review");
    expect(queuedJob.statusLabel).toBe("Needs review");
    expect(queuedJob.partsUsed).toBe(2);
    expect(queuedJob.dueAt).toBe(
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
