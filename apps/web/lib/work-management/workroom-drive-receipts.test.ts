import { describe, expect, it } from "vitest";

import { err, ok } from "@/lib/shared/action-result";
import {
  WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND,
  appendCompletingWorkroomDriveReceipt,
  isCompletingWorkroomDriveReceipt,
} from "./workroom-drive-receipts";

describe("appendCompletingWorkroomDriveReceipt", () => {
  it("refuses blocked as a completing kind", () => {
    expect(appendCompletingWorkroomDriveReceipt([], {
      stageKey: "read",
      kind: WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND,
    })).toEqual(err("blocked_kind_not_completing"));
  });

  it("appends a completing receipt and drops the blocked marker for that stage", () => {
    const result = appendCompletingWorkroomDriveReceipt(
      [{ stageKey: "read", kind: WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND }],
      { stageKey: "read", kind: "findings" },
    );
    expect(result).toEqual(ok([{ stageKey: "read", kind: "findings" }]));
    if (!result.ok) return;
    expect(isCompletingWorkroomDriveReceipt(result.data[0]!, "read")).toBe(true);
  });

  it("is idempotent for the same stageKey and kind", () => {
    const first = appendCompletingWorkroomDriveReceipt([], { stageKey: "read", kind: "findings" });
    expect(first).toEqual(ok([{ stageKey: "read", kind: "findings" }]));
    if (!first.ok) return;
    expect(appendCompletingWorkroomDriveReceipt(first.data, {
      stageKey: "read",
      kind: "findings",
    })).toEqual(first);
  });

  it("refuses an empty stage or kind", () => {
    expect(appendCompletingWorkroomDriveReceipt([], { stageKey: " ", kind: "findings" }))
      .toEqual(err("invalid_receipt"));
    expect(appendCompletingWorkroomDriveReceipt([], { stageKey: "read", kind: "" }))
      .toEqual(err("invalid_receipt"));
  });
});
