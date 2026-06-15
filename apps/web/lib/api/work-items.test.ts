import { describe, it, expect } from "vitest";
import {
  isWorkItemStatus,
  isValidWorkItemTransition,
  toWorkItemSummary,
  toWorkItemDetail,
  statusUpdateData,
  type WorkItemRow,
} from "./work-items";

const baseRow: WorkItemRow = {
  itemId: "WI-1",
  title: "Replace compressor",
  status: "claimed",
  urgency: "urgent",
  effortClass: "medium",
  dueAt: new Date("2026-06-15T09:00:00.000Z"),
  queueId: "q1",
  teamId: "t1",
  createdAt: new Date("2026-06-14T08:00:00.000Z"),
  description: "Unit down at site",
  sourceType: "service-request",
  sourceId: "SR-9",
  assignedToUserId: "u1",
  claimedAt: new Date("2026-06-14T08:30:00.000Z"),
  completedAt: null,
};

describe("isWorkItemStatus", () => {
  it("accepts known statuses and rejects others", () => {
    expect(isWorkItemStatus("in-progress")).toBe(true);
    expect(isWorkItemStatus("queued")).toBe(true);
    expect(isWorkItemStatus("bogus")).toBe(false);
    expect(isWorkItemStatus(null)).toBe(false);
  });
});

describe("isValidWorkItemTransition", () => {
  it("allows the field check-in/out flow", () => {
    expect(isValidWorkItemTransition("queued", "claimed")).toBe(true);
    expect(isValidWorkItemTransition("claimed", "in-progress")).toBe(true);
    expect(isValidWorkItemTransition("in-progress", "completed")).toBe(true);
    expect(isValidWorkItemTransition("claimed", "queued")).toBe(true);
    expect(isValidWorkItemTransition("in-progress", "claimed")).toBe(true);
  });
  it("rejects illegal and no-op transitions", () => {
    expect(isValidWorkItemTransition("queued", "completed")).toBe(false);
    expect(isValidWorkItemTransition("completed", "in-progress")).toBe(false);
    expect(isValidWorkItemTransition("claimed", "claimed")).toBe(false);
  });
});

describe("toWorkItemSummary / toWorkItemDetail", () => {
  it("projects dates to ISO strings and keeps summary fields", () => {
    const s = toWorkItemSummary(baseRow);
    expect(s).toEqual({
      itemId: "WI-1",
      title: "Replace compressor",
      status: "claimed",
      urgency: "urgent",
      effortClass: "medium",
      dueAt: "2026-06-15T09:00:00.000Z",
      queueId: "q1",
      teamId: "t1",
      createdAt: "2026-06-14T08:00:00.000Z",
    });
  });
  it("falls back to queued for an unknown stored status", () => {
    expect(toWorkItemSummary({ ...baseRow, status: "weird" }).status).toBe(
      "queued",
    );
  });
  it("detail adds description + timestamps", () => {
    const d = toWorkItemDetail(baseRow);
    expect(d.description).toBe("Unit down at site");
    expect(d.claimedAt).toBe("2026-06-14T08:30:00.000Z");
    expect(d.completedAt).toBeNull();
    expect(d.assignedToUserId).toBe("u1");
  });
  it("detail tolerates missing optional fields", () => {
    const minimal: WorkItemRow = {
      itemId: "WI-2",
      title: "x",
      status: "queued",
      urgency: "routine",
      effortClass: "small",
      dueAt: null,
      queueId: "q",
      teamId: null,
      createdAt: new Date("2026-06-14T00:00:00.000Z"),
    };
    const d = toWorkItemDetail(minimal);
    expect(d.description).toBe("");
    expect(d.dueAt).toBeNull();
    expect(d.teamId).toBeNull();
  });
});

describe("statusUpdateData", () => {
  const now = new Date("2026-06-14T10:00:00.000Z");
  it("stamps claimedAt when claiming", () => {
    expect(statusUpdateData("claimed", now)).toEqual({
      status: "claimed",
      claimedAt: now,
    });
  });
  it("stamps completedAt when completing", () => {
    expect(statusUpdateData("completed", now)).toEqual({
      status: "completed",
      completedAt: now,
    });
  });
  it("no stamps for in-progress / queued", () => {
    expect(statusUpdateData("in-progress", now)).toEqual({
      status: "in-progress",
    });
    expect(statusUpdateData("queued", now)).toEqual({ status: "queued" });
  });
});
