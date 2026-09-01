import { describe, expect, it } from "vitest";

import {
  areaForPortfolio,
  deriveProactivityRoster,
  groupRosterByArea,
} from "./proactivity-roster";
import { PROACTIVITY_LEVELS } from "./proactivity-types";

const agents = [
  { agentId: "coo", displayName: "Chief Operating Officer", role: "orchestrator" },
  { agentId: "bookkeeper", displayName: "Bookkeeper", role: "analyst" },
];

describe("deriveProactivityRoster", () => {
  // BI-87C9C91C — a saved per-coworker override no longer influences resolution
  // anywhere, so the roster must not display one. Every row reports the derived
  // default, and no row can claim to be owner-set.
  it("reports the derived default and never marks a row owner-set", () => {
    const rows = deriveProactivityRoster(agents);
    for (const row of rows) {
      expect(row.isOverride).toBe(false);
      expect(PROACTIVITY_LEVELS).toContain(row.level);
      expect(typeof row.explanation).toBe("string");
    }
  });

  it("resolves the same level for every coworker, whoever they are", () => {
    const rows = deriveProactivityRoster(agents);
    const levels = new Set(rows.map((row) => row.level));
    expect(levels.size).toBe(1);
  });

  it("preserves each coworker's identity fields in order", () => {
    const rows = deriveProactivityRoster(agents);
    expect(rows.map((row) => row.displayName)).toEqual([
      "Chief Operating Officer",
      "Bookkeeper",
    ]);
    expect(rows.map((row) => row.role)).toEqual(["orchestrator", "analyst"]);
  });

  it("maps a portfolio slug to a plain owner-facing area, else Other", () => {
    expect(areaForPortfolio("products_and_services_sold").label).toBe("Customers and sales");
    expect(areaForPortfolio("for_employees").label).toBe("Your team");
    expect(areaForPortfolio("foundational").label).toBe("Platform and back office");
    expect(areaForPortfolio(null).key).toBe("other");
    expect(areaForPortfolio("nope").key).toBe("other");
  });

  it("groups rows into areas ordered from the customer inward", () => {
    const rows = deriveProactivityRoster(
      [
        { agentId: "eng", displayName: "Platform Engineer", role: "operator", portfolioSlug: "foundational" },
        { agentId: "sales", displayName: "Customer Advisor", role: "specialist", portfolioSlug: "products_and_services_sold" },
        { agentId: "hr", displayName: "HR", role: "specialist", portfolioSlug: "for_employees" },
      ],
    );
    const groups = groupRosterByArea(rows);
    expect(groups.map((group) => group.area.label)).toEqual([
      "Customers and sales",
      "Your team",
      "Platform and back office",
    ]);
    expect(groups[0]?.rows[0]?.displayName).toBe("Customer Advisor");
  });
});
