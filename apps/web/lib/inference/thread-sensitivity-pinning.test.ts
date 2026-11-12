// BI-706530B2 — reproduction, on ref 2cc284539.
//
// One trigger word anywhere in a thread's history restricts EVERY later turn in
// that thread, for the life of the thread, because history is resent and the
// screen is recomputed over the whole payload each turn.
//
// This file is the research gate: it proves the property is real and pins the
// two halves of it apart, so a fix can be judged.
//
//   1. The routing consequence is correct and must stay. History genuinely is
//      sent, so a governed value in message[0] genuinely leaves the box on
//      turn 40. Nothing here proposes changing that.
//   2. The OWNER-FACING consequence is the defect: nothing tells the owner the
//      thread is pinned, which message pinned it, or that the pin comes from
//      history rather than from what they just typed.

import { describe, expect, it } from "vitest";
import { screenInferencePayload } from "./data-screening/screen-inference-payload";

/** Historical false-positive specimen: domain prose with no protected value. */
const DOMAIN_ONLY_HISTORY =
  "Our SaaS categories are CRM, payroll, analytics, and helpdesk; the invoice total was charged to the card on file.";
/** A real value-shaped invoice remains protected even when it is in history. */
const EARLY_TRIGGER = "Invoice INV-1042 total: $125.00.";
/** Utterly unrelated to the trigger, and to any governed data class. */
const CURRENT_TURN = "What is on the agenda for the leadership offsite?";

function screenThread(messages: { role: "user" | "assistant"; content: string }[]) {
  return screenInferencePayload({
    systemPrompt: "You are the COO. Help the operator run the company.",
    messages,
    tools: [],
  });
}

describe("BI-706530B2 — a thread is pinned by its history", () => {
  it("restricts an unrelated later turn when protected invoice data is still in history", () => {
    const fresh = screenThread([{ role: "user", content: CURRENT_TURN }]);
    expect(fresh.receipt.measuredSensitivity).not.toBe("restricted");
    expect(fresh.receipt.routeEffect).not.toBe("local-only");

    const pinned = screenThread([
      { role: "user", content: EARLY_TRIGGER },
      { role: "assistant", content: "Noted — four categories." },
      { role: "user", content: CURRENT_TURN },
    ]);

    // The protected record is still sent, so the later unrelated question
    // must not erase its privacy boundary.
    expect(pinned.receipt.measuredSensitivity).toBe("restricted");
    expect(pinned.receipt.routeEffect).toBe("local-only");
  });

  it("does not pin later turns on the original invoice-domain prose (BI-12CD3010)", () => {
    const result = screenThread([
      { role: "user", content: DOMAIN_ONLY_HISTORY },
      { role: "assistant", content: "Noted - four categories." },
      { role: "user", content: CURRENT_TURN },
    ]);
    expect(result.receipt.measuredSensitivity).not.toBe("restricted");
    expect(result.receipt.routeEffect).toBe("allow");
    expect(result.classification.dataEvidencedClasses).not.toContain("payments-finance");
  });

  it("the receipt knows WHICH message pinned it — the owner has no way to", () => {
    const pinned = screenThread([
      { role: "user", content: EARLY_TRIGGER },
      { role: "assistant", content: "Noted — four categories." },
      { role: "user", content: CURRENT_TURN },
    ]);

    const escalating = (pinned.receipt.matchProvenance ?? []).filter(
      (row) => row.origin === "turn" || row.origin === undefined,
    );
    expect(escalating.length).toBeGreaterThan(0);

    // Every escalating match sits in HISTORY. None of them is the turn the
    // operator just took. That distinction is the whole defect: it is present
    // in the receipt and surfaced nowhere.
    const currentTurnIndex = 2;
    const indices = escalating
      .map((row) => /^messages\[(\d+)\]/.exec(row.path)?.[1])
      .filter((value): value is string => value !== undefined)
      .map(Number);
    expect(indices.length).toBeGreaterThan(0);
    expect(indices.every((index) => index < currentTurnIndex)).toBe(true);
  });
});
