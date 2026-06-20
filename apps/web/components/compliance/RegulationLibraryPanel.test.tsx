import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RegulationLibraryPanel, type RegulationLibraryRow } from "./RegulationLibraryPanel";

const ROWS: RegulationLibraryRow[] = [
  {
    id: "reg-bsa",
    regulationId: "REG-US-BSA-AML",
    name: "Bank Secrecy Act / Anti-Money Laundering",
    shortName: "BSA/AML",
    jurisdiction: "US-federal",
    industry: "financial",
    sourceType: "external",
    sourceUrl: "https://www.fincen.gov/resources/statutes-and-regulations/bank-secrecy-act",
    status: "active",
    _count: { obligations: 5 },
    applicability: {
      scope: "reference",
      label: "Reference",
      reason: "Seeded for banking or financial services; installed archetype is Software Platform.",
    },
  },
  {
    id: "reg-state",
    regulationId: "REG-US-STATE-OPEN-MEETINGS",
    name: "State Open Meetings Law (Sunshine Law)",
    shortName: "Open Meetings",
    jurisdiction: "US-state",
    industry: "public-sector",
    sourceType: "external",
    sourceUrl: null,
    status: "active",
    _count: { obligations: 4 },
    applicability: {
      scope: "review",
      label: "Needs review",
      reason: "Matches Public Sector, but the applicable state has not been captured.",
    },
  },
];

describe("RegulationLibraryPanel", () => {
  it("renders explicit details and source actions for list rows", () => {
    const html = renderToStaticMarkup(
      <RegulationLibraryPanel
        rows={ROWS}
        totalCount={2}
        contextLabel="Software Platform (software-platform)"
        activeScope="all"
        scopeCounts={{ applies: 0, review: 1, reference: 1, all: 2 }}
      />,
    );

    expect(html).toContain("Details");
    expect(html).toContain("Source");
    expect(html).toContain("Source needed");
    expect(html).toContain("Seeded for banking or financial services");
    expect(html).toContain("data-intent=\"neutral\"");
    expect(html).toContain("data-intent=\"warning\"");
  });

  it("renders a scoped empty state with a path to the full library", () => {
    const html = renderToStaticMarkup(
      <RegulationLibraryPanel
        rows={[]}
        totalCount={2}
        contextLabel="Software Platform (software-platform)"
        activeScope="applies"
        scopeCounts={{ applies: 0, review: 1, reference: 1, all: 2 }}
      />,
    );

    expect(html).toContain("No regulations in this scope");
    expect(html).toContain("View all");
  });
});
