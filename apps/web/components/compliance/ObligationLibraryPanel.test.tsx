import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ObligationLibraryPanel, type ObligationLibraryRow } from "./ObligationLibraryPanel";

const ROWS: ObligationLibraryRow[] = [
  {
    id: "obl-1",
    title: "Suspicious Activity Report filing",
    category: "operational",
    applicability: "All insured depositories",
    ownerEmployee: { id: "emp-1", displayName: "Compliance Lead" },
    _count: { controls: 1 },
    regulation: {
      id: "reg-bsa",
      regulationId: "REG-US-BSA-AML",
      name: "Bank Secrecy Act / Anti-Money Laundering",
      shortName: "BSA/AML",
      jurisdiction: "US-federal",
      industry: "financial",
      sourceType: "external",
      sourceUrl: "https://www.fincen.gov/resources/statutes-and-regulations/bank-secrecy-act",
      applicability: {
        scope: "reference",
        label: "Reference",
        reason: "Seeded for banking or financial services; installed archetype is Software Platform.",
      },
    },
  },
  {
    id: "obl-2",
    title: "Public notice of meetings within the statutory notice period",
    category: "governance",
    applicability: "All public bodies",
    ownerEmployee: null,
    _count: { controls: 0 },
    regulation: {
      id: "reg-state",
      regulationId: "REG-US-STATE-OPEN-MEETINGS",
      name: "State Open Meetings Law (Sunshine Law)",
      shortName: "Open Meetings",
      jurisdiction: "US-state",
      industry: "public-sector",
      sourceType: "external",
      sourceUrl: null,
      applicability: {
        scope: "review",
        label: "Needs review",
        reason: "Matches Public Sector, but the applicable state has not been captured.",
      },
    },
  },
];

describe("ObligationLibraryPanel", () => {
  it("renders parent regulation applicability and source actions", () => {
    const html = renderToStaticMarkup(
      <ObligationLibraryPanel
        rows={ROWS}
        contextLabel="Software Platform (software-platform)"
        totalCount={2}
      />,
    );

    expect(html).toContain("Suspicious Activity Report filing");
    expect(html).toContain("Reference");
    expect(html).toContain("Needs review");
    expect(html).toContain("Details");
    expect(html).toContain("Source");
    expect(html).toContain("Source needed");
    expect(html).toContain("1 control");
    expect(html).toContain("0 controls");
  });

  it("renders an honest empty state", () => {
    const html = renderToStaticMarkup(
      <ObligationLibraryPanel
        rows={[]}
        contextLabel="Software Platform (software-platform)"
        totalCount={12}
      />,
    );

    expect(html).toContain("No obligations in this scope");
    expect(html).toContain("12 obligations remain");
  });
});
