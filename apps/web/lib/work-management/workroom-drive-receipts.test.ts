import { describe, expect, it } from "vitest";

import {
  WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND,
  appendCompletingWorkroomDriveReceipt,
  isCompletingWorkroomDriveReceipt,
} from "./workroom-drive-receipts";

describe("appendCompletingWorkroomDriveReceipt", () => {
  it("refuses blocked as a completing kind", () => {
    const result = appendCompletingWorkroomDriveReceipt([], {
      stageKey: "read",
      kind: WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND,
    });
    expect(result).toEqual({ ok: false, error: "blocked_kind_not_completing" });
  });

  it("appends a completing receipt and drops the blocked marker for that stage", () => {
    const result = appendCompletingWorkroomDriveReceipt(
      [{ stageKey: "read", kind: WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND }],
      { stageKey: "read", kind: "findings" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipts).toEqual([{ stageKey: "read", kind: "findings" }]);
    expect(isCompletingWorkroomDriveReceipt(result.receipts[0]!, "read")).toBe(true);
  });

  it("is idempotent for the same stageKey and kind", () => {
    const first = appendCompletingWorkroomDriveReceipt([], { stageKey: "read", kind: "findings" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = appendCompletingWorkroomDriveReceipt(first.receipts, {
      stageKey: "read",
      kind: "findings",
    });
    expect(second).toEqual(first);
  });

  it("refuses an empty stage or kind", () => {
    expect(appendCompletingWorkroomDriveReceipt([], { stageKey: " ", kind: "findings" })).toEqual({
      ok: false,
      error: "invalid_receipt",
    });
    expect(appendCompletingWorkroomDriveReceipt([], { stageKey: "read", kind: "" })).toEqual({
      ok: false,
      error: "invalid_receipt",
    });
  });
});
