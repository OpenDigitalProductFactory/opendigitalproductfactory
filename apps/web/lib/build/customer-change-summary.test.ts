import { describe, expect, it } from "vitest";

import { customerChangeSummaryText } from "./customer-change-summary";

const narrative = {
  headline: "Repeat customers now get an automatic 10% discount.",
  bullets: ["Discount applies at checkout", "No code needed"],
  whyItMatters: "It rewards loyalty without manual work.",
  generatedAt: "2026-07-11T00:00:00.000Z",
  model: "test",
};

describe("customerChangeSummaryText (BI-5EA94BD1)", () => {
  it("composes the plain summary from the change narrative headline + why-it-matters", () => {
    expect(customerChangeSummaryText({ changeNarrative: narrative })).toBe(
      "Repeat customers now get an automatic 10% discount. It rewards loyalty without manual work.",
    );
  });

  it("returns just the headline when there is no why-it-matters", () => {
    expect(
      customerChangeSummaryText({ changeNarrative: { ...narrative, whyItMatters: "" } }),
    ).toBe("Repeat customers now get an automatic 10% discount.");
  });

  it("returns null (not a raw diff) when there is no narrative — so the plain layer shows 'no summary yet'", () => {
    expect(customerChangeSummaryText({ changeNarrative: null })).toBeNull();
    expect(customerChangeSummaryText({})).toBeNull();
    expect(customerChangeSummaryText({ changeNarrative: { ...narrative, headline: "  " } })).toBeNull();
  });

  it("cannot leak the raw diff: diffSummary is not part of the input signature", () => {
    // Passing a diffSummary-looking field has no effect — it is not read.
    const out = customerChangeSummaryText({
      changeNarrative: null,
      // @ts-expect-error diffSummary is intentionally absent from the input type
      diffSummary: "diff --git a/x b/x\n+lots of code",
    });
    expect(out).toBeNull();
  });
});
