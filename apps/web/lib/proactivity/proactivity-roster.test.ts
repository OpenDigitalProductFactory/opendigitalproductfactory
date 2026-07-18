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
  it("uses the owner override level and marks the row as owner-set", () => {
    const rows = deriveProactivityRoster(agents, { bookkeeper: "assertive" });
    const book = rows.find((row) => row.agentId === "bookkeeper");
    expect(book?.isOverride).toBe(true);
    expect(book?.level).toBe("assertive");
  });

  it("falls back to a posture-derived default when there is no override", () => {
    const rows = deriveProactivityRoster(agents, {});
    for (const row of rows) {
      expect(row.isOverride).toBe(false);
      expect(PROACTIVITY_LEVELS).toContain(row.level);
      expect(typeof row.explanation).toBe("string");
    }
  });

  it("preserves each coworker's identity fields in order", () => {
    const rows = deriveProactivityRoster(agents, {});
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
      {},
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
