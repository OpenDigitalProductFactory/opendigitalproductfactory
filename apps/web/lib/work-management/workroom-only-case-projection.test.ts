import { describe, expect, it } from "vitest";

import {
  loadWorkroomOnlyCaseDetail,
  type WorkroomOnlyPrismaClient,
  type WorkroomOnlyRecord,
} from "./workroom-only-case-projection";

const NOW = new Date("2026-09-07T12:00:00.000Z");

function client(room: WorkroomOnlyRecord | null): WorkroomOnlyPrismaClient {
  return {
    workroom: {
      async findFirst(args: any) {
        return room && room.capsuleId === args.where.capsuleId ? room : null;
      },
    },
  };
}

const room = (over: Partial<WorkroomOnlyRecord> = {}): WorkroomOnlyRecord => ({
  capsuleId: "WC-ALPHA",
  title: "Reconcile the ledger",
  status: "working",
  objective: "Bring the September ledger into agreement with the bank feed.",
  workItemId: null,
  updatedAt: NOW,
  ...over,
});

const load = (r: WorkroomOnlyRecord | null, sourceId = "WC-ALPHA") =>
  loadWorkroomOnlyCaseDetail({
    prismaClient: client(r),
    sourceId,
    // The route hands the loader the encoded key; buildWorkroomView enforces it.
    caseKey: encodeURIComponent(`work-capsule:${sourceId}`),
    now: NOW,
  });

describe("loadWorkroomOnlyCaseDetail", () => {
  it("opens a room that anchors no WorkItem instead of leaving it unreachable", async () => {
    // 290 of 464 rooms on the live install have no workItemId (BI-2C31C399);
    // every one of them served the not-found boundary from the activity tree.
    const detail = await load(room());
    expect(detail).not.toBeNull();
    expect(detail!.summary.title).toContain("Reconcile the ledger");
    expect(detail!.workItemId).toBeNull();
  });

  it("addresses the case by the same helper the tree links with", async () => {
    const detail = await load(room());
    expect(detail!.summary.href).toBe("/workspace/cases/work-capsule%3AWC-ALPHA");
  });

  it("leaves an anchored room to its WorkItem's case so one unit of work has one case", async () => {
    // Not a 404: the caller redirects an anchored room to the item's case.
    const detail = await load(room({ workItemId: "wi-1" }));
    expect(detail).toBeNull();
  });

  it("is genuinely not found when no such room exists", async () => {
    expect(await load(null)).toBeNull();
    expect(await load(room(), "WC-MISSING")).toBeNull();
  });

  it("says an objective was not recorded rather than restating the title as intent", async () => {
    const detail = await load(room({ objective: null }));
    expect(detail!.room!.purpose).toContain("No objective was recorded");
    expect(detail!.summary.description).toBeNull();
  });

  it("treats whitespace as no objective", async () => {
    const detail = await load(room({ objective: "   " }));
    expect(detail!.room!.purpose).toContain("No objective was recorded");
  });

  it("carries the room's own objective as its purpose when one is recorded", async () => {
    const detail = await load(room());
    expect(detail!.room!.purpose).toContain("September ledger");
  });

  it("states the fields it does not know rather than implying a value", async () => {
    const detail = await load(room());
    expect(detail!.summary.urgencyLabel).toBe("Not recorded");
    expect(detail!.summary.effortLabel).toBe("Not recorded");
    expect(detail!.summary.assignmentLabel).toBe("Not recorded");
  });

  it("raises attention only for a blocked room, with the reason", async () => {
    const working = await load(room());
    expect(working!.summary.attentionRequired).toBe(false);
    expect(working!.summary.attentionReason).toBeNull();

    const blocked = await load(room({ status: "blocked" }));
    expect(blocked!.summary.attentionRequired).toBe(true);
    expect(blocked!.summary.attentionReason).toContain("blocked");
  });

  it("returns a serialisable detail with no undefined dueAt", async () => {
    const detail = await load(room());
    expect(detail!.summary.dueAt).toBeNull();
    expect(() => JSON.stringify(detail)).not.toThrow();
  });
});
