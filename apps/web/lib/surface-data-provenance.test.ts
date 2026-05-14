import { describe, expect, it } from "vitest";
import {
  getDataSourceBadgeLabel,
  getDataSourceDescription,
  getDataSourceTone,
  isTrustedOperationalSource,
  type DataSourceKind,
  type DataSourceProvenance,
} from "@/lib/surface-data-provenance";

describe("surface data provenance", () => {
  it("labels each source kind with operator-facing language", () => {
    const expected: Record<DataSourceKind, string> = {
      "live-db": "Live data",
      "connected-account": "Connected account",
      computed: "Computed",
      catalog: "Catalog",
      "seed-default": "Seed default",
      "demo-placeholder": "Demo placeholder",
      "not-connected": "Not connected",
    };

    for (const [kind, label] of Object.entries(expected) as Array<[DataSourceKind, string]>) {
      expect(getDataSourceBadgeLabel({ kind, description: `${kind} source` })).toBe(label);
    }
  });

  it("uses explicit labels and source details when supplied", () => {
    const provenance: DataSourceProvenance = {
      kind: "demo-placeholder",
      label: "Planning placeholder",
      description: "Seeded planning value, not connected finance.",
      sourceTable: "Portfolio",
      sourceRoute: "/portfolio",
      lastVerifiedAt: "2026-05-13T20:00:00.000Z",
    };

    expect(getDataSourceBadgeLabel(provenance)).toBe("Planning placeholder");
    expect(getDataSourceDescription(provenance)).toContain("Seeded planning value");
    expect(getDataSourceDescription(provenance)).toContain("Portfolio");
    expect(getDataSourceDescription(provenance)).toContain("/portfolio");
    expect(getDataSourceDescription(provenance)).toContain("2026-05-13");
  });

  it("distinguishes operational sources from placeholders and missing connections", () => {
    expect(isTrustedOperationalSource("live-db")).toBe(true);
    expect(isTrustedOperationalSource("connected-account")).toBe(true);
    expect(isTrustedOperationalSource("computed")).toBe(true);
    expect(isTrustedOperationalSource("catalog")).toBe(false);
    expect(isTrustedOperationalSource("seed-default")).toBe(false);
    expect(isTrustedOperationalSource("demo-placeholder")).toBe(false);
    expect(isTrustedOperationalSource("not-connected")).toBe(false);
  });

  it("maps tone to theme-token classes instead of hardcoded colors", () => {
    const tone = getDataSourceTone("demo-placeholder");

    expect(tone.className).toContain("var(--dpf-");
    expect(tone.dotClassName).toContain("var(--dpf-");
    expect(`${tone.className} ${tone.dotClassName}`).not.toMatch(/#[0-9a-fA-F]{3,6}|text-gray|bg-white/);
  });
});
