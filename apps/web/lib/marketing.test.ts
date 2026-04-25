import { describe, expect, it } from "vitest";
import { formatMarketingGap, formatMarketingLabel } from "./marketing";

describe("marketing language helpers", () => {
  it("uses marketer-facing labels for seeded strategy values", () => {
    expect(formatMarketingLabel("content-seo")).toBe("Search-led content");
    expect(formatMarketingLabel("direct-sales")).toBe("Sales-led outreach");
    expect(formatMarketingLabel("draft")).toBe("Needs strategist review");
  });

  it("translates raw strategy gaps into user-actionable language", () => {
    expect(formatMarketingGap("Geographic scope needs review")).toBe(
      "Decide where we want to win customers first: local, regional, national, or international.",
    );
    expect(formatMarketingGap("Proof assets are still missing")).toBe(
      "Pick the proof that will make the offer credible: outcomes, testimonials, case studies, or credentials.",
    );
  });
});
