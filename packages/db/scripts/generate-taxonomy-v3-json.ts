// packages/db/scripts/generate-taxonomy-v3-json.ts
// Run once: pnpm --filter @dpf/db exec tsx scripts/generate-taxonomy-v3-json.ts
// Reads 4_portfolio_Reworked_V3_Definitions_IT4IT.xlsx, outputs taxonomy_v3.json

import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { readWorkbook, requireSheetData, sheetDataToObjects } from "../src/excel-sheet-reader";

const XLSX_PATH = join(__dirname, "..", "..", "..", "docs", "Reference", "4_portfolio_Reworked_V3_Definitions_IT4IT.xlsx");
const OUT_DIR   = join(__dirname, "..", "data");
const OUT_PATH  = join(OUT_DIR, "taxonomy_v3.json");

// Sheet name → portfolio metadata
const SHEET_MAP: Record<string, { portfolio: string; portfolio_id: string }> = {
  "For Employees":                  { portfolio: "For Employees",             portfolio_id: "for_employees" },
  "Foundational":                   { portfolio: "Foundational",              portfolio_id: "foundational" },
  "Manufacturing and and Delivery": { portfolio: "Manufacturing and Delivery", portfolio_id: "manufacturing_and_delivery" },
  "Products and Services Sold":     { portfolio: "Products and Services Sold", portfolio_id: "products_and_services_sold" },
};

// Industry column header → slug key for industryMarkets
const INDUSTRY_SLUG_MAP: Record<string, string> = {
  "Generic Commercial Market and Products":                          "generic",
  "Banking Commercial market and Products":                          "banking",
  "Banking Commercial Market and Products":                          "banking",
  "Insurance Commercial market and Products":                        "insurance",
  "Insurance Commercial Market and Products":                        "insurance",
  "Capital Markets Commercial market and Products":                  "capital_markets",
  "Capital Markets Commercial Market and Products":                  "capital_markets",
  "Healthcare Provider Commercial market and Products":              "healthcare",
  "Healthcare Provider Commercial Market and Products":              "healthcare",
  "Life Sciences and Pharma Commercial market and Products":         "life_sciences",
  "Life Sciences and Pharma Commercial Market and Products":         "life_sciences",
  "Retail and eCommerce Commercial market and Products":             "retail",
  "Retail and eCommerce Commercial Market and Products":             "retail",
  "Media and Streaming Commercial market and Products":              "media",
  "Media and Streaming Commercial Market and Products":              "media",
  "Telecommunications Commercial market and Products":               "telecommunications",
  "Telecommunications Commercial Market and Products":               "telecommunications",
  "Automotive and Mobility Commercial market and Products":          "automotive",
  "Automotive and Mobility Commercial Market and Products":          "automotive",
  "Manufacturing and Industrial Commercial market and Products":     "manufacturing",
  "Manufacturing and Industrial Commercial Market and Products":     "manufacturing",
  "Energy (Oil and Gas) Commercial market and Products":             "energy",
  "Energy (Oil and Gas) Commercial Market and Products":             "energy",
  "Chemicals Commercial market and Products":                        "chemicals",
  "Chemicals Commercial Market and Products":                        "chemicals",
  "Utilities Commercial market and Products":                        "utilities",
  "Utilities Commercial Market and Products":                        "utilities",
  "Transportation and Logistics Commercial market and Products":     "transportation",
  "Transportation and Logistics Commercial Market and Products":     "transportation",
};

// Known enrichment column names (non-industry)
const ENRICHMENT_COLUMNS: Record<string, string> = {
  "Sample Services":                                    "sampleServices",
  "Offering Considerations":                            "offeringConsiderations",
  "Common Commercial Market and Products":              "commercialMarket",
  "Common Commercial market and Products":              "commercialMarket",
  "Companies in who Provide These Goods and Services":  "commercialMarket",
  "Digital/Physical":                                   "digitalPhysical",
  "Goods/Services":                                     "goodsServices",
  "Primary External Consumer":                          "primaryConsumer",
  "Consumption Channel":                                "consumptionChannel",
  "Commercial Model":                                   "commercialModel",
  "Provisioning and Entitlement Model":                 "provisioningModel",
  "Platform/Ecosystem":                                 "platformEcosystem",
};

type TaxonomyRow = {
  portfolio:    string;
  portfolio_id: string;
  level_1:      string;
  level_2:      string;
  level_3:      string;
  definition:   string;
  notes:        string;
  enrichment:   Record<string, unknown>;
};

function cleanString(val: unknown): string {
  if (val === null || val === undefined) return "";
  return String(val).trim().replace(/\u00AD/g, "").replace(/[\u2013\u2014]/g, "-").replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
}

function processSheet(rawRows: Array<Record<string, unknown>>, sheetName: string): TaxonomyRow[] {
  const meta = SHEET_MAP[sheetName];
  if (!meta) throw new Error(`Unknown sheet: ${sheetName}`);
  const rows: TaxonomyRow[] = [];

  for (const raw of rawRows) {
    const level1 = cleanString(raw["Level 1"]);
    const level2 = cleanString(raw["Level 2"]);
    const level3 = cleanString(raw["Level 3"]);
    const definition = cleanString(raw["Definition"]);
    const notes = cleanString(raw["Notes"]);

    if (!level1) continue; // skip empty rows

    // Build enrichment object
    const enrichment: Record<string, unknown> = {};

    // Non-industry enrichment columns
    for (const [header, key] of Object.entries(ENRICHMENT_COLUMNS)) {
      const val = cleanString(raw[header]);
      if (val) enrichment[key] = val;
    }

    // Industry-specific columns
    const industryMarkets: Record<string, string> = {};
    for (const [header, slug] of Object.entries(INDUSTRY_SLUG_MAP)) {
      const val = cleanString(raw[header]);
      if (val) industryMarkets[slug] = val;
    }
    if (Object.keys(industryMarkets).length > 0) {
      enrichment.industryMarkets = industryMarkets;
    }

    rows.push({
      portfolio:    meta.portfolio,
      portfolio_id: meta.portfolio_id,
      level_1:      level1,
      level_2:      level2,
      level_3:      level3,
      definition,
      notes,
      enrichment:   Object.keys(enrichment).length > 0 ? enrichment : {},
    });
  }

  return rows;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const workbook = await readWorkbook(XLSX_PATH);
  const sheetNames = Object.keys(SHEET_MAP);
  console.log(`Sheets found: ${sheetNames.join(", ")}`);

  const allRows: TaxonomyRow[] = [];
  for (const sheetName of sheetNames) {
    const rows = processSheet(sheetDataToObjects(requireSheetData(workbook, sheetName)), sheetName);
    console.log(`  ${sheetName}: ${rows.length} rows`);
    allRows.push(...rows);
  }

  writeFileSync(OUT_PATH, JSON.stringify(allRows, null, 2), "utf-8");
  console.log(`\nWritten ${allRows.length} rows to ${OUT_PATH}`);
}

void main();
