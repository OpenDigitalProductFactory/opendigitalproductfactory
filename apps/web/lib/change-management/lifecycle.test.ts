import { describe, expect, it } from "vitest";
import {
  VALID_TRANSITIONS,
  assertValidTransition,
  isValidTransition,
  timestampFieldForStatus,
  stampTimestampsThrough,
  makeRfcId,
} from "./lifecycle";

describe("VALID_TRANSITIONS", () => {
  it("encodes the ITIL RFC lifecycle", () => {
    expect(VALID_TRANSITIONS.draft).toEqual(["submitted", "cancelled"]);
    expect(VALID_TRANSITIONS["in-progress"]).toEqual(["completed", "rolled-back"]);
    expect(VALID_TRANSITIONS.completed).toEqual(["closed"]);
    expect(VALID_TRANSITIONS["rolled-back"]).toEqual(["closed"]);
  });
});

describe("isValidTransition", () => {
  it("accepts legal forward steps", () => {
    expect(isValidTransition("scheduled", "in-progress")).toBe(true);
    expect(isValidTransition("in-progress", "completed")).toBe(true);
    expect(isValidTransition("in-progress", "rolled-back")).toBe(true);
    expect(isValidTransition("scheduled", "cancelled")).toBe(true);
  });
  it("rejects illegal steps", () => {
    expect(isValidTransition("draft", "approved")).toBe(false);
    expect(isValidTransition("completed", "draft")).toBe(false);
    expect(isValidTransition("closed", "completed")).toBe(false);
    expect(isValidTransition("nonsense", "closed")).toBe(false);
  });
});

describe("assertValidTransition", () => {
  it("throws with an explanatory message on an illegal step", () => {
    expect(() => assertValidTransition("draft", "approved")).toThrow(
      /Invalid transition.*draft.*approved/,
    );
  });
  it("does not throw on a legal step", () => {
    expect(() => assertValidTransition("draft", "submitted")).not.toThrow();
  });
});

describe("timestampFieldForStatus", () => {
  it("maps statuses to their timestamp columns", () => {
    expect(timestampFieldForStatus("submitted")).toBe("submittedAt");
    expect(timestampFieldForStatus("in-progress")).toBe("startedAt");
    expect(timestampFieldForStatus("completed")).toBe("completedAt");
    expect(timestampFieldForStatus("closed")).toBe("closedAt");
  });
  it("returns null for states without a column (draft, rolled-back, cancelled)", () => {
    expect(timestampFieldForStatus("draft")).toBeNull();
    expect(timestampFieldForStatus("rolled-back")).toBeNull();
    expect(timestampFieldForStatus("cancelled")).toBeNull();
  });
});

describe("stampTimestampsThrough", () => {
  const now = new Date("2026-06-16T12:00:00Z");

  it("stamps every linear stage up to and including a fast-forward target", () => {
    const stamps = stampTimestampsThrough("scheduled", now);
    expect(stamps).toEqual({
      submittedAt: now,
      assessedAt: now,
      approvedAt: now,
      scheduledAt: now,
    });
  });

  it("includes startedAt when created directly at in-progress", () => {
    const stamps = stampTimestampsThrough("in-progress", now);
    expect(stamps.startedAt).toEqual(now);
    expect(stamps.scheduledAt).toEqual(now);
    expect(stamps.completedAt).toBeUndefined();
  });

  it("stamps nothing for a non-linear stage (no whole-ladder footgun)", () => {
    expect(stampTimestampsThrough("draft", now)).toEqual({});
    expect(stampTimestampsThrough("rolled-back", now)).toEqual({});
  });
});

describe("makeRfcId", () => {
  it("returns RFC-YYYY-XXXXXXXX format", () => {
    const id = makeRfcId(new Date("2026-06-16T00:00:00Z"));
    expect(id).toMatch(/^RFC-2026-[0-9A-F]{8}$/);
  });
  it("generates unique ids", () => {
    const ids = new Set(Array.from({ length: 50 }, () => makeRfcId()));
    expect(ids.size).toBe(50);
  });
});
