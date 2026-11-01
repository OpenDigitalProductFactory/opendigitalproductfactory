import { describe, expect, it } from "vitest";

import {
  OUTCOME_MAX_LENGTH,
  deriveDraftOutcome,
  derivedOutcomeAdvisory,
  resolveItemOutcome,
  statedOutcomeFromBody,
} from "./intake-outcome";

// BI-8DE5429B: every backlog item carries its own outcome in one field. A
// stated outcome is kept as stated; with none, a deterministic draft is derived
// from the item's own context and marked derived (WWMD DI-342D45001EF5,
// DI-D50BBC916B6D).

describe("statedOutcomeFromBody", () => {
  it("lifts the text under an Outcome heading, up to the next heading", () => {
    const body = "## Outcome\nOperators see their queue.\nWithin a second.\n\n## Acceptance\n- AC-1 x";
    expect(statedOutcomeFromBody(body)).toBe("Operators see their queue.\nWithin a second.");
  });

  it("lifts an Outcome: line, bold or plain", () => {
    expect(statedOutcomeFromBody("Context.\nOutcome: invoices send on time")).toBe("invoices send on time");
    expect(statedOutcomeFromBody("- **Outcome:** invoices send on time")).toBe("invoices send on time");
  });

  it("finds none in prose that only mentions outcomes, or an empty section", () => {
    expect(statedOutcomeFromBody("We discussed outcomes at length.")).toBeNull();
    expect(statedOutcomeFromBody("## Outcome\n\n## Acceptance\nx")).toBeNull();
    expect(statedOutcomeFromBody(null)).toBeNull();
  });
});

describe("deriveDraftOutcome", () => {
  it("says a defect no longer happens, and is the same every time", () => {
    const item = { title: "[tool] Save button does nothing.", workType: "bug" };
    expect(deriveDraftOutcome(item)).toBe('The reported problem no longer happens: "Save button does nothing".');
    expect(deriveDraftOutcome(item)).toBe(deriveDraftOutcome(item));
  });

  it("says other work is in place and working for the people it is for", () => {
    expect(deriveDraftOutcome({ title: "Export invoices as CSV", workType: "feature" }))
      .toBe('"Export invoices as CSV" is in place and working for the people it is for.');
  });

  it("stays within the column ceiling for a very long title", () => {
    expect(deriveDraftOutcome({ title: "x".repeat(5000), workType: "chore" }).length).toBeLessThanOrEqual(OUTCOME_MAX_LENGTH);
  });
});

describe("resolveItemOutcome", () => {
  it("keeps an explicit outcome as stated", () => {
    expect(resolveItemOutcome({ outcome: " Peers can export. ", body: "## Outcome\nother", title: "t" }))
      .toEqual({ outcome: "Peers can export.", outcomeSource: "stated" });
  });

  it("treats an Outcome section the filer wrote as stated", () => {
    expect(resolveItemOutcome({ body: "## Outcome\nPeers can export.", title: "t" }))
      .toEqual({ outcome: "Peers can export.", outcomeSource: "stated" });
  });

  it("derives a draft, marked derived, when nobody stated one", () => {
    expect(resolveItemOutcome({ body: "Just a request.", title: "Dark mode", workType: "feature" }))
      .toEqual({ outcome: '"Dark mode" is in place and working for the people it is for.', outcomeSource: "derived" });
  });

  it("the derived advisory names the draft and how to correct it, and does not refuse", () => {
    const note = derivedOutcomeAdvisory("X is true.");
    expect(note).toContain('"X is true."');
    expect(note).toContain("update_backlog_item");
  });
});
