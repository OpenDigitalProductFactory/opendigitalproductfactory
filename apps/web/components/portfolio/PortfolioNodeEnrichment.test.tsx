import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PortfolioNodeEnrichment } from "./PortfolioNodeEnrichment";
import type { EnrichmentView } from "@/lib/portfolio/portfolio-node-view-model";

const empty: EnrichmentView = {
  standards: null,
  patterns: null,
  references: null,
  sampleServices: null,
  offeringConsiderations: null,
  commercialMarket: null,
  sectorCommercialMarkets: null,
  raw: null,
};

function view(overrides: Partial<EnrichmentView>): EnrichmentView {
  return { ...empty, ...overrides };
}

describe("PortfolioNodeEnrichment", () => {
  it("returns null when all fields are null", () => {
    expect(renderToStaticMarkup(<PortfolioNodeEnrichment enrichment={empty} />)).toBe("");
  });

  it("returns null when all collections are present but empty", () => {
    const allEmpty: EnrichmentView = {
      standards: [],
      patterns: [],
      references: [],
      sampleServices: null,
      offeringConsiderations: null,
      commercialMarket: null,
      sectorCommercialMarkets: [],
      raw: null,
    };
    expect(renderToStaticMarkup(<PortfolioNodeEnrichment enrichment={allEmpty} />)).toBe("");
  });

  it("renders standards list when present", () => {
    const html = renderToStaticMarkup(
      <PortfolioNodeEnrichment
        enrichment={view({
          standards: ["ISO 27001", "NIST CSF"],
        })}
      />,
    );
    expect(html).toContain(">Enrichment<");
    expect(html).toContain(">Standards<");
    expect(html).toContain("ISO 27001");
    expect(html).toContain("NIST CSF");
    expect(html).not.toContain(">Patterns<");
    expect(html).not.toContain(">References<");
  });

  it("renders patterns list when present", () => {
    const html = renderToStaticMarkup(
      <PortfolioNodeEnrichment
        enrichment={view({
          patterns: ["circuit-breaker", "saga"],
        })}
      />,
    );
    expect(html).toContain(">Patterns<");
    expect(html).toContain("circuit-breaker");
    expect(html).toContain("saga");
  });

  it("renders references as anchors with rel/target", () => {
    const html = renderToStaticMarkup(
      <PortfolioNodeEnrichment
        enrichment={view({
          references: [
            { label: "ISO 27001 overview", href: "https://example.com/iso27001" },
          ],
        })}
      />,
    );
    expect(html).toContain(">References<");
    expect(html).toContain("ISO 27001 overview");
    expect(html).toContain('href="https://example.com/iso27001"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("renders commercial market guidance with progressive disclosure", () => {
    const enrichment = {
      standards: null,
      patterns: null,
      references: null,
      sampleServices: "Capability mapping; Product fit review",
      offeringConsiderations: "Lightweight advisory vs managed program",
      commercialMarket: "Representative vendors: ServiceNow SPM; Planview; Jira.",
      sectorCommercialMarkets: [
        { sector: "Retail / eCommerce", market: "Shopify; Square; Lightspeed" },
      ],
      raw: {
        industryMarkets: { retail: "Shopify; Square; Lightspeed" },
        secretKey: "should-not-leak",
      },
    };

    const html = renderToStaticMarkup(<PortfolioNodeEnrichment enrichment={enrichment} />);

    expect(html).toContain(">Sample services<");
    expect(html).toContain("Capability mapping; Product fit review");
    expect(html).toContain("<details");
    expect(html).toContain(">Offering considerations<");
    expect(html).toContain(">Commercial market and products<");
    expect(html).toContain("Representative vendors: ServiceNow SPM; Planview; Jira.");
    expect(html).toContain(">Sector market guidance<");
    expect(html).toContain("Retail / eCommerce");
    expect(html).toContain("Shopify; Square; Lightspeed");
    expect(html).not.toContain("industryMarkets");
    expect(html).not.toContain("secretKey");
    expect(html).not.toContain("should-not-leak");
  });

  it("does not render raw JSON blob in output", () => {
    const html = renderToStaticMarkup(
      <PortfolioNodeEnrichment
        enrichment={view({
          standards: ["ISO 27001"],
          patterns: ["saga"],
          references: [{ label: "Doc", href: "https://example.com" }],
          raw: { standards: ["ISO 27001"], secretKey: "should-not-leak" },
        })}
      />,
    );
    expect(html).not.toContain('"standards"');
    expect(html).not.toContain('"patterns"');
    expect(html).not.toContain("secretKey");
    expect(html).not.toContain("should-not-leak");
  });

  it("uses theme tokens only", () => {
    const html = renderToStaticMarkup(
      <PortfolioNodeEnrichment
        enrichment={view({
          standards: ["ISO 27001"],
          references: [{ label: "Doc", href: "https://example.com" }],
        })}
      />,
    );
    expect(html).not.toMatch(/text-white|text-black|text-gray-|bg-white|bg-black|bg-gray-/);
    expect(html).toContain("var(--dpf-");
  });
});
