// BI-706530B2 — the notice must be true, and the action must work.
//
// The dangerous failure here is not silence, it is a confident wrong offer:
// telling an owner "start a fresh conversation" when the trigger is in the
// message they just sent costs them their whole thread and changes nothing.

import { describe, expect, it } from "vitest";
import { deriveThreadSensitivityNotice } from "./thread-sensitivity-notice";
import type { InferenceMatchProvenance } from "./data-screening/types";

function turnMatch(index: number, reason = "payment-or-finance-text"): InferenceMatchProvenance {
  return {
    dataClass: "payments-finance",
    path: `messages[${index}].content`,
    reason,
    confidence: "inferred",
    origin: "turn",
  };
}

function notice(
  provenance: InferenceMatchProvenance[] | undefined,
  currentTurnStartIndex: number,
  routeEffect: "allow" | "local-only" | "block" = "local-only",
) {
  return deriveThreadSensitivityNotice({
    receipt: {
      routeEffect,
      classifiedDataClasses: ["payments-finance"],
      matchProvenance: provenance,
    },
    currentTurnStartIndex,
  });
}

describe("thread sensitivity notice", () => {
  it("says nothing when routing is normal", () => {
    expect(notice([turnMatch(0)], 2, "allow")).toBeNull();
  });

  it("says nothing when the receipt predates provenance", () => {
    // A notice with no cause is worse than no notice: it names a constraint
    // and then cannot say what to do about it.
    expect(notice(undefined, 2)).toBeNull();
  });

  it("offers a fresh conversation when the cause is entirely in history", () => {
    const result = notice([turnMatch(0), turnMatch(1)], 4);
    expect(result?.pin).toBe("history");
    expect(result?.action?.kind).toBe("continue-in-new-thread");
    expect(result?.messageIndices).toEqual([0, 1]);
  });

  it("does NOT offer a fresh conversation when the current turn also triggers", () => {
    // Mixed: a new thread re-triggers on the first message. Offering it would
    // trade the owner's context for nothing.
    const result = notice([turnMatch(0), turnMatch(5)], 4);
    expect(result?.pin).toBe("mixed");
    expect(result?.action).toBeNull();
  });

  it("does NOT offer a fresh conversation when only the current turn triggers", () => {
    const result = notice([turnMatch(4), turnMatch(5)], 4);
    expect(result?.pin).toBe("current-turn");
    expect(result?.action).toBeNull();
  });

  it("ignores instruction-origin matches — they set no floor and are not the owner's doing", () => {
    const result = notice(
      [
        {
          dataClass: "employee-records",
          path: "systemPrompt.instruction[0]",
          reason: "employee-record-ambiguous-term",
          confidence: "inferred",
        },
        turnMatch(1),
      ],
      4,
    );
    expect(result?.pin).toBe("history");
    expect(result?.messageIndices).toEqual([1]);
  });

  it("reports a setup-level cause as unclearable rather than blaming the conversation", () => {
    const result = notice(
      [
        {
          dataClass: "employee-records",
          path: "tools[2].description",
          reason: "employee-record-text",
          confidence: "inferred",
        },
      ],
      0,
    );
    expect(result?.pin).toBe("outside-conversation");
    expect(result?.action).toBeNull();
    expect(result?.detail).toContain("a new");
  });

  it("never carries message content — only indices", () => {
    const result = notice([turnMatch(0)], 4);
    expect(JSON.stringify(result)).not.toContain("content");
  });
});
