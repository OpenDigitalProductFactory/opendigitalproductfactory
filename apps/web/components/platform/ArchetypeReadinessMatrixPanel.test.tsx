import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ARCHETYPE_READINESS_MATRIX } from "@dpf/storefront-templates";

import {
  ArchetypeReadinessMatrixPanel,
  buildArchetypeReadinessRows,
  formatArchetypeReadinessLabel,
} from "./ArchetypeReadinessMatrixPanel";

describe("ArchetypeReadinessMatrixPanel", () => {
  it("derives its rows from the shared archetype readiness matrix", () => {
    const rows = buildArchetypeReadinessRows();

    expect(rows.map((row) => row.categorySlug)).toEqual(
      ARCHETYPE_READINESS_MATRIX.map((record) => record.archetypeCategory),
    );
    expect(rows.every((row) => row.evidenceRefs.some((ref) => ref.id === "BI-PSC-010"))).toBe(
      true,
    );
  });

  it("renders every matrix category with claim blockers and evidence refs", () => {
    const html = renderToStaticMarkup(<ArchetypeReadinessMatrixPanel />);

    expect(html.match(/data-archetype-readiness-category=/g)).toHaveLength(
      ARCHETYPE_READINESS_MATRIX.length,
    );
    for (const record of ARCHETYPE_READINESS_MATRIX) {
      expect(html).toContain(formatArchetypeReadinessLabel(record.archetypeCategory));
    }
    expect(html).toContain("Gate is on");
    expect(html).toContain("Template Ready");
    expect(html).toContain("Sole Platform Ready");
    expect(html).toContain("BI-PSC-010");
    expect(html).toContain("BI-903F5A94");
    expect(html).toContain("All claims");
  });
});
