import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PortfolioNodeEnrichment } from "./PortfolioNodeEnrichment";
import type { EnrichmentView } from "@/lib/portfolio/portfolio-node-view-model";

const empty: EnrichmentView = {
  standards: null,
  patterns: null,
  references: null,
  raw: null,
};

describe("PortfolioNodeEnrichment", () => {
  it("returns null when all fields are null", () => {
    expect(renderToStaticMarkup(<PortfolioNodeEnrichment enrichment={empty} />)).toBe("");
  });

  it("returns null when all collections are present but empty", () => {
    const allEmpty: EnrichmentView = {
      standards: [],
      patterns: [],
      references: [],
      raw: null,
    };
    expect(renderToStaticMarkup(<PortfolioNodeEnrichment enrichment={allEmpty} />)).toBe("");
  });

  it("renders standards list when present", () => {
    const html = renderToStaticMarkup(
      <PortfolioNodeEnrichment
        enrichment={{
          standards: ["ISO 27001", "NIST CSF"],
          patterns: null,
          references: null,
          raw: null,
        }}
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
        enrichment={{
          standards: null,
          patterns: ["circuit-breaker", "saga"],
          references: null,
          raw: null,
        }}
      />,
    );
    expect(html).toContain(">Patterns<");
    expect(html).toContain("circuit-breaker");
    expect(html).toContain("saga");
  });

  it("renders references as anchors with rel/target", () => {
    const html = renderToStaticMarkup(
      <PortfolioNodeEnrichment
        enrichment={{
          standards: null,
          patterns: null,
          references: [
            { label: "ISO 27001 overview", href: "https://example.com/iso27001" },
          ],
          raw: null,
        }}
      />,
    );
    expect(html).toContain(">References<");
    expect(html).toContain("ISO 27001 overview");
    expect(html).toContain('href="https://example.com/iso27001"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("does not render raw JSON blob in output", () => {
    const html = renderToStaticMarkup(
      <PortfolioNodeEnrichment
        enrichment={{
          standards: ["ISO 27001"],
          patterns: ["saga"],
          references: [{ label: "Doc", href: "https://example.com" }],
          raw: { standards: ["ISO 27001"], secretKey: "should-not-leak" },
        }}
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
        enrichment={{
          standards: ["ISO 27001"],
          patterns: null,
          references: [{ label: "Doc", href: "https://example.com" }],
          raw: null,
        }}
      />,
    );
    expect(html).not.toMatch(/text-white|text-black|text-gray-|bg-white|bg-black|bg-gray-/);
    expect(html).toContain("var(--dpf-");
  });
});
