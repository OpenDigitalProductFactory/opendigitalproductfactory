import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { DeliberationSummaryCard } from "./DeliberationSummaryCard";

describe("DeliberationSummaryCard", () => {
  it("renders the phase, badges, rationale, and unresolved risks", () => {
    const html = renderToStaticMarkup(
      <DeliberationSummaryCard
        phase="plan"
        summary={{
          patternSlug: "review",
          deliberationRunId: "del-1",
          consensusState: "partial-consensus",
          rationaleSummary: "Two reviewers agreed, but one skeptic flagged weak evidence.",
          evidenceQuality: "mixed",
          unresolvedRisks: ["Provider capability claims need fresher citations."],
          diversityLabel: "Same model, multiple personas",
        }}
      />,
    );

    expect(html).toContain("Plan Deliberation");
    expect(html).toContain("Peer Review");
    expect(html).toContain("mixed");
    expect(html).toContain("Same model, multiple personas");
    expect(html).toContain("partial-consensus");
    expect(html).toContain("Two reviewers agreed");
    expect(html).toContain("Unresolved Risks");
    expect(html).toContain("Provider capability claims need fresher citations.");
  });
});
