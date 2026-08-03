import { describe, expect, it } from "vitest";
import type { CapacityAttentionSignal } from "@/lib/capacity/contracts";
import { selectRentalPrimaryAttention } from "./rental-operations";

function attention(kind: CapacityAttentionSignal["kind"], detail: string): CapacityAttentionSignal {
  return { signalId: `signal-${kind}`, kind, authority: "rental", detail };
}

describe("rental first-viewport attention", () => {
  it("shows exactly one highest-priority exception and recommended action", () => {
    expect(selectRentalPrimaryAttention([
      attention("idle-capacity", "Loader #4 is idle."),
      attention("kit-incomplete", "Camera kit is missing two items."),
      attention("overdue-return", "RA-101 is overdue."),
    ])).toEqual({
      signalId: "signal-overdue-return",
      kind: "overdue-return",
      title: "Overdue return",
      detail: "RA-101 is overdue.",
      recommendedAction: "Contact the customer and protect the next booking window.",
      urgency: "critical",
    });
  });

  it("uses self-storage and re-pool language instead of generic job vocabulary", () => {
    expect(selectRentalPrimaryAttention([
      attention("occupancy-opportunity", "Unit 214 is vacant with four prospects waiting."),
    ])).toMatchObject({
      title: "Fill a vacant unit",
      recommendedAction: "Allocate the best-fit waiting tenant to this unit.",
    });
    expect(selectRentalPrimaryAttention([
      attention("repool-not-ready", "Excavator #2 needs cleaning."),
    ])).toMatchObject({
      title: "Not ready to re-pool",
      recommendedAction: "Complete readiness work before offering this unit again.",
    });
  });

  it("returns null when the rental operation has no exception", () => {
    expect(selectRentalPrimaryAttention([])).toBeNull();
  });
});
