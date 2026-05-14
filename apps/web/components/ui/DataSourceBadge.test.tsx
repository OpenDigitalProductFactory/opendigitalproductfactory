import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DataSourceBadge } from "@/components/ui/DataSourceBadge";

describe("DataSourceBadge", () => {
  it("renders visible source context for placeholder data", () => {
    const html = renderToStaticMarkup(
      <DataSourceBadge
        provenance={{
          kind: "demo-placeholder",
          label: "Planning placeholder",
          description: "Seeded planning value, not connected finance.",
          sourceTable: "Portfolio",
        }}
      />,
    );

    expect(html).toContain('data-source-kind="demo-placeholder"');
    expect(html).toContain("Planning placeholder");
    expect(html).toContain("Seeded planning value");
    expect(html).toContain("Portfolio");
  });

  it("can render compact source labels without hiding the accessible description", () => {
    const html = renderToStaticMarkup(
      <DataSourceBadge
        compact
        provenance={{
          kind: "live-db",
          description: "Read from TokenUsage rows.",
          sourceTable: "TokenUsage",
        }}
      />,
    );

    expect(html).toContain("Live data");
    expect(html).toContain("Read from TokenUsage rows.");
    expect(html).toContain('aria-label="Data source: Live data');
  });

  it("uses DPF theme tokens rather than fixed color utilities", () => {
    const html = renderToStaticMarkup(
      <DataSourceBadge
        provenance={{
          kind: "not-connected",
          description: "Provider billing is not connected.",
        }}
      />,
    );

    expect(html).toContain("var(--dpf-");
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}|text-gray|bg-white|border-gray/);
  });
});
