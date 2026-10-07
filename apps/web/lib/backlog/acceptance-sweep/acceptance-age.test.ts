import { describe, expect, it, vi } from "vitest";

import { acceptanceEnteredAt, loadAcceptanceEntry } from "./acceptance-age";

// AC-AA-02 (docs/superpowers/specs/2026-09-24-acceptance-accountability-design.md §3.2):
// age runs from the latest state entry; without one it is reported against
// createdAt with ageBasis "created"; updatedAt is never read.

const createdAt = new Date("2026-07-02T00:00:00.000Z");

function statusChange(recordedAt: string, from: string, to: string, extra: Record<string, unknown> = {}) {
  return { kind: "status_change", recordedAt: new Date(recordedAt), payload: { from, to, ...extra } };
}

describe("acceptanceEnteredAt", () => {
  it("measures from the latest entry into awaiting-acceptance", () => {
    const result = acceptanceEnteredAt([
      statusChange("2026-08-01T00:00:00.000Z", "in-progress", "awaiting-acceptance"),
      statusChange("2026-08-05T00:00:00.000Z", "awaiting-acceptance", "in-progress"),
      statusChange("2026-09-21T10:00:00.000Z", "in-progress", "awaiting-acceptance", { actuator: "pr-submit-backfill" }),
    ], createdAt);
    expect(result).toEqual({ enteredAt: new Date("2026-09-21T10:00:00.000Z"), ageBasis: "entry" });
  });

  it("does not depend on activity order", () => {
    const result = acceptanceEnteredAt([
      statusChange("2026-09-21T10:00:00.000Z", "open", "awaiting-acceptance"),
      statusChange("2026-08-01T00:00:00.000Z", "in-progress", "awaiting-acceptance"),
    ], createdAt);
    expect(result.enteredAt).toEqual(new Date("2026-09-21T10:00:00.000Z"));
  });

  it("never counts an acceptance-miss row (from and to the same status) as entry", () => {
    const result = acceptanceEnteredAt([
      statusChange("2026-08-01T00:00:00.000Z", "in-progress", "awaiting-acceptance"),
      statusChange("2026-09-30T00:00:00.000Z", "awaiting-acceptance", "awaiting-acceptance", { reason: "verification-fail" }),
    ], createdAt);
    expect(result).toEqual({ enteredAt: new Date("2026-08-01T00:00:00.000Z"), ageBasis: "entry" });
  });

  it("ignores other kinds and other targets", () => {
    const result = acceptanceEnteredAt([
      { kind: "deferral_review", recordedAt: new Date("2026-09-01T00:00:00.000Z"), payload: { from: "deferred", to: "awaiting-acceptance" } },
      statusChange("2026-09-02T00:00:00.000Z", "open", "in-progress"),
      { kind: "status_change", recordedAt: new Date("2026-09-03T00:00:00.000Z"), payload: null },
    ], createdAt);
    expect(result).toEqual({ enteredAt: createdAt, ageBasis: "created" });
  });

  it("falls back to createdAt with ageBasis created when no entry row exists", () => {
    expect(acceptanceEnteredAt([], createdAt)).toEqual({ enteredAt: createdAt, ageBasis: "created" });
  });
});

describe("loadAcceptanceEntry", () => {
  it("reads entry rows and createdAt, and never updatedAt", async () => {
    const itemRow = { createdAt };
    Object.defineProperty(itemRow, "updatedAt", {
      enumerable: true,
      get() {
        throw new Error("updatedAt must never be read as acceptance age");
      },
    });
    const findUnique = vi.fn().mockResolvedValue(itemRow);
    const findMany = vi.fn().mockResolvedValue([
      { recordedAt: new Date("2026-09-10T00:00:00.000Z"), payload: { from: "in-progress", to: "awaiting-acceptance" } },
      { recordedAt: new Date("2026-09-20T00:00:00.000Z"), payload: { from: "awaiting-acceptance", to: "awaiting-acceptance" } },
    ]);

    const result = await loadAcceptanceEntry(
      { backlogItem: { findUnique }, backlogItemActivity: { findMany } },
      "bi_row_1",
    );

    expect(result).toEqual({ enteredAt: new Date("2026-09-10T00:00:00.000Z"), ageBasis: "entry" });
    expect(findUnique).toHaveBeenCalledWith({ where: { id: "bi_row_1" }, select: { createdAt: true } });
    expect(JSON.stringify(findUnique.mock.calls)).not.toContain("updatedAt");
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        backlogItemId: "bi_row_1",
        kind: "status_change",
        payload: { path: ["to"], equals: "awaiting-acceptance" },
      },
      select: { recordedAt: true, payload: true },
    }));
  });

  it("returns null for a missing item", async () => {
    const result = await loadAcceptanceEntry(
      { backlogItem: { findUnique: vi.fn().mockResolvedValue(null) }, backlogItemActivity: { findMany: vi.fn().mockResolvedValue([]) } },
      "missing",
    );
    expect(result).toBeNull();
  });
});
