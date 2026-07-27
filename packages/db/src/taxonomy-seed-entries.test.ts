import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildTaxonomyNodeEntries, type TaxonomySeedRow } from "./taxonomy-seed-entries";

const taxonomyPath = join(__dirname, "..", "data", "taxonomy_v3.json");
const portfolioRegistryPath = join(__dirname, "..", "data", "portfolio_registry.json");

const taxonomyRows = JSON.parse(readFileSync(taxonomyPath, "utf8")) as TaxonomySeedRow[];
const portfolioRegistry = JSON.parse(readFileSync(portfolioRegistryPath, "utf8")) as {
  portfolios: Array<{ id: string; name: string }>;
};

describe("taxonomy seed entries", () => {
  it("uses portfolio registry names for root taxonomy labels", () => {
    const entries = buildTaxonomyNodeEntries(taxonomyRows, portfolioRegistry.portfolios);

    expect(entries.find((entry) => entry.nodeId === "for_employees")?.name).toBe("Workforce");
    expect(
      entries.find((entry) => entry.nodeId === "products_and_services_sold")?.name,
    ).toBe("Goods and Services for Sale");
    expect(
      new Set(
        taxonomyRows
          .filter((row) => row.portfolio_id === "for_employees")
          .map((row) => row.portfolio),
      ),
    ).toEqual(new Set(["For Employees"]));
  });
});
