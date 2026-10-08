import { describe, expect, it } from "vitest";

import { err, ok } from "@/lib/shared/action-result";
import {
  WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND,
  appendCompletingWorkroomDriveReceipt,
  isCompletingWorkroomDriveReceipt,
  isCompletingWorkroomDriveReceiptAt,
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

// GPP Phase 3c PR-3c-1 (BI-8875C9DF): iteration-scoped receipts.
describe("iteration-scoped receipts (Phase 3c)", () => {
  it("legacy dedupe is unchanged: a receipt without iteration dedupes on (stageKey, kind)", () => {
    const existing = [{ stageKey: "a", kind: "k" }];
    expect(appendCompletingWorkroomDriveReceipt(existing, { stageKey: "a", kind: "k" })).toEqual(ok([{ stageKey: "a", kind: "k" }]));
    expect(appendCompletingWorkroomDriveReceipt(existing, { stageKey: "a", kind: "k", iteration: 0 })).toEqual(ok([{ stageKey: "a", kind: "k" }]));
  });

  it("dedupes on (stageKey, kind, iteration ?? 0): a new iteration's receipt is kept beside the old one", () => {
    const existing = [{ stageKey: "a", kind: "k" }];
    const result = appendCompletingWorkroomDriveReceipt(existing, { stageKey: "a", kind: "k", iteration: 1 });
    expect(result).toEqual(ok([{ stageKey: "a", kind: "k" }, { stageKey: "a", kind: "k", iteration: 1 }]));
    expect(appendCompletingWorkroomDriveReceipt(result.ok ? result.data : [], { stageKey: "a", kind: "k", iteration: 1 }))
      .toEqual(result);
  });

  it("a receipt without iteration never gains an iteration key", () => {
    const result = appendCompletingWorkroomDriveReceipt([], { stageKey: "a", kind: "k" });
    expect(result.ok && Object.hasOwn(result.data[0]!, "iteration")).toBe(false);
  });

  it("isCompletingWorkroomDriveReceiptAt completes a stage only at its own iteration", () => {
    expect(isCompletingWorkroomDriveReceiptAt({ stageKey: "a", kind: "k" }, "a", 0)).toBe(true);
    expect(isCompletingWorkroomDriveReceiptAt({ stageKey: "a", kind: "k" }, "a", 1)).toBe(false);
    expect(isCompletingWorkroomDriveReceiptAt({ stageKey: "a", kind: "k", iteration: 1 }, "a", 1)).toBe(true);
    expect(isCompletingWorkroomDriveReceiptAt({ stageKey: "a", kind: WORKROOM_DRIVE_BLOCKED_RECEIPT_KIND, iteration: 1 }, "a", 1)).toBe(false);
    expect(isCompletingWorkroomDriveReceiptAt({ stageKey: "b", kind: "k", iteration: 1 }, "a", 1)).toBe(false);
  });

  // BI-086DC167: a graph receipt carries the run it was earned in.
  it("a receipt carrying a run key completes a stage only within that run; one without keeps its meaning", () => {
    const run = "shape@1.0.0:2026-03-02";
    expect(isCompletingWorkroomDriveReceiptAt({ stageKey: "a", kind: "k", iteration: 0, runKey: run }, "a", 0, run)).toBe(true);
    expect(isCompletingWorkroomDriveReceiptAt({ stageKey: "a", kind: "k", iteration: 0, runKey: run }, "a", 0, "shape@1.0.0:2026-03-03")).toBe(false);
    expect(isCompletingWorkroomDriveReceiptAt({ stageKey: "a", kind: "k" }, "a", 0, run)).toBe(true);
    expect(isCompletingWorkroomDriveReceiptAt({ stageKey: "a", kind: "k", runKey: run }, "a", 0)).toBe(true);
  });

  it("deduplicates on the run key too, and writes it only when given", () => {
    const first = appendCompletingWorkroomDriveReceipt([], { stageKey: "a", kind: "k", iteration: 0, runKey: "r1" });
    expect(first.ok && first.data).toEqual([{ stageKey: "a", kind: "k", iteration: 0, runKey: "r1" }]);
    const again = appendCompletingWorkroomDriveReceipt(first.ok ? first.data : [], { stageKey: "a", kind: "k", iteration: 0, runKey: "r1" });
    expect(again.ok && again.data).toHaveLength(1);
    const next = appendCompletingWorkroomDriveReceipt(first.ok ? first.data : [], { stageKey: "a", kind: "k", iteration: 0, runKey: "r2" });
    expect(next.ok && next.data.map((receipt) => receipt.runKey)).toEqual(["r1", "r2"]);
    const legacy = appendCompletingWorkroomDriveReceipt([], { stageKey: "a", kind: "k" });
    expect(legacy.ok && Object.hasOwn(legacy.data[0]!, "runKey")).toBe(false);
  });
});
