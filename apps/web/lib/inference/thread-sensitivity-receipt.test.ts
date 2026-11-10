// BI-706530B2 — persisted receipts are opaque JSON written by older screeners.
// Every install has years of them. The reader's job is to refuse anything it
// cannot honestly interpret rather than guess.

import { describe, expect, it } from "vitest";
import { readThreadSensitivityReceipt } from "./thread-sensitivity-receipt";

const CURRENT = {
  routeEffect: "local-only",
  classifiedDataClasses: ["payments-finance"],
  currentTurnStartIndex: 4,
  matchProvenance: [
    { dataClass: "payments-finance", path: "messages[0].content", reason: "x", confidence: "inferred", origin: "turn" },
  ],
};

describe("thread sensitivity receipt reader", () => {
  it("reads a current receipt", () => {
    const receipt = readThreadSensitivityReceipt(CURRENT);
    expect(receipt?.currentTurnStartIndex).toBe(4);
    expect(receipt?.matchProvenance).toHaveLength(1);
  });

  it("refuses a receipt with no turn anchor rather than guessing one", () => {
    // Defaulting to 0 would call every match "current turn" and suppress the
    // action; defaulting to Infinity would call every match "history" and offer
    // a fresh thread that does not help. Both are confident and wrong.
    const { currentTurnStartIndex: _omitted, ...legacy } = CURRENT;
    expect(readThreadSensitivityReceipt(legacy)).toBeNull();
  });

  it("refuses junk", () => {
    expect(readThreadSensitivityReceipt(null)).toBeNull();
    expect(readThreadSensitivityReceipt("local-only")).toBeNull();
    expect(readThreadSensitivityReceipt({ routeEffect: "sideways", currentTurnStartIndex: 1 })).toBeNull();
  });

  it("drops malformed provenance rows without dropping the receipt", () => {
    const receipt = readThreadSensitivityReceipt({
      ...CURRENT,
      matchProvenance: [{ path: "messages[1].content" }, ...CURRENT.matchProvenance],
    });
    expect(receipt?.matchProvenance).toHaveLength(1);
  });

  it("accepts a receipt whose payload carried no user message", () => {
    const receipt = readThreadSensitivityReceipt({ ...CURRENT, currentTurnStartIndex: -1 });
    expect(receipt?.currentTurnStartIndex).toBe(-1);
  });
});
