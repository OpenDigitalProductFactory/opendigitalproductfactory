import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { DeliberationDrilldown } from "./DeliberationDrilldown";

describe("DeliberationDrilldown", () => {
  it("renders claims, evidence bundles, and adjudication notes", () => {
    const html = renderToStaticMarkup(
      <DeliberationDrilldown
        title="Plan Debate Details"
        adjudicationNotes="The debate narrowed the issue to provider freshness and retrieval quality."
        claims={[
          {
            claimId: "c1",
            claimType: "assertion",
            claimText: "The proposal should require live provider checks.",
            evidenceGrade: "A",
            status: "supported",
          },
        ]}
        evidenceBundles={[
          {
            bundleId: "b1",
            summary: "Provider documentation excerpts",
            sourceCount: 2,
          },
        ]}
      />,
    );

    expect(html).toContain("Plan Debate Details");
    expect(html).toContain("The debate narrowed the issue");
    expect(html).toContain("Claims");
    expect(html).toContain("assertion");
    expect(html).toContain("Grade A");
    expect(html).toContain("The proposal should require live provider checks.");
    expect(html).toContain("Evidence Bundles");
    expect(html).toContain("Provider documentation excerpts");
    expect(html).toContain("2 sources");
  });
});
