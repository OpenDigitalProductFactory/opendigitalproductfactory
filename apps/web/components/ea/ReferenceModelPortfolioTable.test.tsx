import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReferenceModelPortfolioTable } from "./ReferenceModelPortfolioTable";

describe("ReferenceModelPortfolioTable", () => {
  it("renders coverage counts by portfolio and status", () => {
    const html = renderToStaticMarkup(
      <ReferenceModelPortfolioTable
        rows={[
          {
            scopeRef: "foundational",
            scopeName: "Foundational",
            counts: {
              implemented: 3,
              partial: 2,
              planned: 1,
              not_started: 0,
              out_of_mvp: 0,
            },
            mvpIncludedCount: 6,
            outOfMvpCount: 0,
          },
        ]}
      />
    );

    expect(html).toContain("Foundational");
    expect(html).toContain("implemented");
    expect(html).toContain(">3<");
    expect(html).toContain("MVP Included");
  });
});
