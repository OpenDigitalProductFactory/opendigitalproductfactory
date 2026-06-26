import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BuildChangeSummaryBand } from "./BuildChangeSummaryBand";
import type { BuildChangeNarrative } from "@/lib/feature-build-types";

// BI-D93CF6C0 — render checks via renderToStaticMarkup (report-kit convention).

function narrative(over: Partial<BuildChangeNarrative> = {}): BuildChangeNarrative {
  return {
    headline: "Repeat customers now get an automatic 10% discount.",
    bullets: ["Applies the discount at checkout", "Shows the saving on the receipt"],
    whyItMatters: "Rewards your regulars without you tracking who qualifies.",
    openQuestions: ["Should it stack with coupon codes?"],
    generatedAt: "2026-06-26T00:00:00.000Z",
    model: "local",
    ...over,
  };
}

describe("BuildChangeSummaryBand", () => {
  it("renders the headline, bullets, why-it-matters, and open questions", () => {
    const html = renderToStaticMarkup(<BuildChangeSummaryBand narrative={narrative()} />);
    expect(html).toContain("What");
    expect(html).toContain("changing");
    expect(html).toContain("automatic 10% discount");
    expect(html).toContain("Applies the discount at checkout");
    expect(html).toContain("Rewards your regulars");
    expect(html).toContain("Should it stack with coupon codes?");
  });

  it("omits the why-it-matters and open-questions sections when they are absent", () => {
    const html = renderToStaticMarkup(
      <BuildChangeSummaryBand narrative={narrative({ whyItMatters: "", openQuestions: undefined })} />,
    );
    expect(html).toContain("automatic 10% discount");
    expect(html).not.toContain("Why it matters");
    expect(html).not.toContain("left open");
  });
});
