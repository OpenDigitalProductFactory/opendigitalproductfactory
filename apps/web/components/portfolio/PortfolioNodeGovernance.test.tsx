import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PortfolioNodeGovernance } from "./PortfolioNodeGovernance";
import type { GovernanceView } from "@/lib/portfolio/portfolio-node-view-model";

const empty: GovernanceView = { promotion: null, requiredFields: null, raw: null };

describe("PortfolioNodeGovernance", () => {
  it("returns null when promotion and requiredFields are both null", () => {
    expect(renderToStaticMarkup(<PortfolioNodeGovernance governance={empty} />)).toBe("");
  });

  it("renders promotion policy as labeled fields when present", () => {
    const html = renderToStaticMarkup(
      <PortfolioNodeGovernance
        governance={{
          promotion: { mode: "auto", classifyAs: "infrastructure_endpoint" },
          requiredFields: null,
          raw: null,
        }}
      />,
    );
    expect(html).toContain(">Governance<");
    expect(html).toContain(">Promotion policy<");
    expect(html).toContain("auto");
    expect(html).toContain("infrastructure_endpoint");
  });

  it("does not render raw JSON blob in output", () => {
    const html = renderToStaticMarkup(
      <PortfolioNodeGovernance
        governance={{
          promotion: { mode: "auto", classifyAs: "infrastructure_endpoint" },
          requiredFields: ["manufacturer"],
          raw: { promotion: { mode: "auto", classifyAs: "infrastructure_endpoint" }, secret: "x" },
        }}
      />,
    );
    // No raw JSON: no curly braces wrapping the literal blob, no quoted keys.
    expect(html).not.toContain('"promotion"');
    expect(html).not.toContain('"mode"');
    expect(html).not.toContain('"classifyAs"');
    expect(html).not.toContain("secret");
  });

  it("renders requiredFields as a list when present", () => {
    const html = renderToStaticMarkup(
      <PortfolioNodeGovernance
        governance={{
          promotion: null,
          requiredFields: ["manufacturer", "observedVersion"],
          raw: null,
        }}
      />,
    );
    expect(html).toContain(">Required fields<");
    expect(html).toContain("<ul");
    expect(html).toContain("<li");
    expect(html).toContain("manufacturer");
    expect(html).toContain("observedVersion");
  });

  it("uses theme tokens only", () => {
    const html = renderToStaticMarkup(
      <PortfolioNodeGovernance
        governance={{
          promotion: { mode: "manual" },
          requiredFields: ["manufacturer"],
          raw: null,
        }}
      />,
    );
    expect(html).not.toMatch(/text-white|text-black|text-gray-|bg-white|bg-black|bg-gray-/);
    expect(html).toContain("var(--dpf-");
  });
});
