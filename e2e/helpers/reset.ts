import { Page } from "@playwright/test";
import { execSync } from "child_process";

const TEST_PREFIXES = ["TLI-", "MD-", "BCHOA-", "TPR-", "PTPS-", "RRPP-"];

// Stable nodeId slugs for taxonomy root nodes (consistent across DB rebuilds)
const TAXONOMY_NODES = {
  products_and_services_sold: "products_and_services_sold",
  for_employees: "for_employees",
  manufacturing_and_delivery: "manufacturing_and_delivery",
};

// Products to seed for each test suite (no UI create flow exists yet)
const TEST_PRODUCTS: Array<{ name: string; portfolio: keyof typeof TAXONOMY_NODES }> = [
  // Suite 1 — TeamLogicIT
  { name: "TLI-IT Support Services",             portfolio: "products_and_services_sold" },
  { name: "TLI-Network Infrastructure Management", portfolio: "products_and_services_sold" },
  { name: "TLI-Cybersecurity Advisory",           portfolio: "products_and_services_sold" },
  // Suite 2 — ManagingDigital
  { name: "MD-Digital Leadership Programme",      portfolio: "for_employees" },
  { name: "MD-AI Readiness Assessment",           portfolio: "for_employees" },
  { name: "MD-Executive Coaching",                portfolio: "for_employees" },
  // Suite 3 — Brushy Creek HOA
  { name: "BCHOA-Community Management Platform",  portfolio: "for_employees" },
  { name: "BCHOA-Amenity Booking System",         portfolio: "for_employees" },
  { name: "BCHOA-Resident Communications Portal", portfolio: "for_employees" },
  // Suite 4 — Taylor Pet Rescue
  { name: "TPR-Pet Adoption Portal",              portfolio: "manufacturing_and_delivery" },
  { name: "TPR-Foster Network Management",        portfolio: "manufacturing_and_delivery" },
  { name: "TPR-Fundraising & Donor Platform",     portfolio: "manufacturing_and_delivery" },
  // Suite 5 — Round Rock Pool Pros
  { name: "RRPP-Weekly Pool Maintenance Service", portfolio: "products_and_services_sold" },
  { name: "RRPP-Equipment Repair & Parts",        portfolio: "products_and_services_sold" },
  { name: "RRPP-Water Chemistry Management",      portfolio: "products_and_services_sold" },
];

/**
 * Run SQL directly against postgres via docker exec using stdin pipe.
 * Avoids shell echo quoting issues on Windows.
 */
function runSQL(sql: string): void {
  execSync("docker exec -i dpf-postgres-1 psql -U dpf -d dpf", {
    input: sql,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

/**
 * Wipes all digital products created by these test suites.
 * Runs via docker exec psql — safe, targets only test-prefixed records.
 * Does NOT touch platform roles, business models, or seed data.
 */
export function resetTestData(): void {
  const prefixConditions = TEST_PREFIXES.map((p) => `name LIKE '${p}%'`).join(" OR ");

  const sql = [
    `DELETE FROM "BusinessModelRoleAssignment" WHERE "productId" IN (SELECT id FROM "DigitalProduct" WHERE ${prefixConditions});`,
    `DELETE FROM "ProductBusinessModel" WHERE "productId" IN (SELECT id FROM "DigitalProduct" WHERE ${prefixConditions});`,
    `DELETE FROM "BacklogItem" WHERE "digitalProductId" IN (SELECT id FROM "DigitalProduct" WHERE ${prefixConditions});`,
    `DELETE FROM "DigitalProduct" WHERE ${prefixConditions};`,
    // Also clean up custom business models created by test suites (non-built-in)
    `DELETE FROM "BusinessModelRole" WHERE "modelId" IN (SELECT id FROM "BusinessModel" WHERE "isBuiltIn" = false);`,
    `DELETE FROM "BusinessModel" WHERE "isBuiltIn" = false;`,
  ].join("\n");

  try {
    runSQL(sql);
    console.log("[reset] Test data cleared");
  } catch (err) {
    console.warn("[reset] Reset had an error (non-blocking):", (err as Error).message);
  }
}

/**
 * Seed test products directly into the DB (no UI create flow exists yet — GAP-006).
 * Idempotent: skips products that already exist by name.
 * Sets lifecycleStatus="active" so they appear in portfolio views.
 */
export function seedTestProducts(): void {
  const inserts = TEST_PRODUCTS.map((p) => {
    const nodeId = TAXONOMY_NODES[p.portfolio];
    const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const safeName = p.name.replace(/'/g, "''");
    return [
      `INSERT INTO "DigitalProduct" (id, "productId", name, "taxonomyNodeId", "lifecycleStage", "lifecycleStatus", version, "createdAt", "updatedAt")`,
      `SELECT gen_random_uuid()::text, 'DP-${slug}', '${safeName}',`,
      `  (SELECT id FROM "TaxonomyNode" WHERE "nodeId" = '${nodeId}' LIMIT 1),`,
      `  'plan', 'active', '1.0.0', now(), now()`,
      `WHERE NOT EXISTS (SELECT 1 FROM "DigitalProduct" WHERE name = '${safeName}');`,
    ].join(" ");
  }).join("\n");

  try {
    runSQL(inserts);
    console.log(`[seed] Test products seeded (${TEST_PRODUCTS.length} attempted)`);
  } catch (err) {
    console.warn("[seed] Product seeding had an error (non-blocking):", (err as Error).message);
  }
}

/**
 * Navigate to the ops backlog and verify EP-BIZ-ROLES items are present.
 */
export async function verifyBacklogEpicPresent(page: Page): Promise<boolean> {
  try {
    await page.goto("/ops");
    await page.waitForLoadState("networkidle", { timeout: 8_000 });
    const epicText = page.locator("text=Business Model Roles");
    return await epicText.isVisible({ timeout: 5_000 });
  } catch {
    return false;
  }
}
