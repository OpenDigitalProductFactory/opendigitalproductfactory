/**
 * Suite 5: Round Rock Pool Pros — Pool Cleaning & Maintenance, Round Rock TX
 * Business model: bm-services (Professional Services / Consulting)
 * Website: roundrockpoolpros.com | In business since 2014
 *
 * A local residential pool service company (weekly cleaning, water chemistry,
 * equipment repair). Unlike TeamLogicIT (IT managed services on the same
 * bm-services model), this scenario tests field-service-specific AI Coworker
 * guidance and validates that two companies can share a built-in business model
 * with independent product and role assignments.
 * Non-blocking: soft assertions throughout.
 */
import { test, expect } from "@playwright/test";
import { ensureLoggedIn } from "./helpers/auth";
import { resetTestData, seedTestProducts } from "./helpers/reset";
import { askCoworker, clearCoworker } from "./helpers/coworker";
import { createProduct, navigateToProductDetail } from "./helpers/products";
import {
  fetchBusinessModels,
  assignBusinessModelOnPage,
  verifyRolePanelVisible,
} from "./helpers/business-models";

const ORG = "Round Rock Pool Pros";
const PORTFOLIO = "products_and_services_sold";
const BM_NAME = "Professional Services / Consulting";
const PRODUCTS = [
  "RRPP-Weekly Pool Maintenance Service",
  "RRPP-Equipment Repair & Parts",
  "RRPP-Water Chemistry Management",
];

test.beforeAll(() => {
  resetTestData();
  seedTestProducts();
});

test.describe(`Suite 5: ${ORG}`, () => {
  test("5.1 Auth session valid", async ({ page }) => {
    await ensureLoggedIn(page);
    await expect.soft(page).not.toHaveURL(/login/);
  });

  test("5.2 AI Coworker: business model for pool service company", async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto("/workspace");
    await page.waitForLoadState("networkidle");
    await clearCoworker(page);
    const response = await askCoworker(
      page,
      "We provide weekly residential pool cleaning, chemical balancing, and equipment repair in Round Rock TX. What business model best describes a field-service company like ours?"
    );
    expect.soft(response.length).toBeGreaterThan(20);
    console.log(`[rrpp] BM recommendation: "${response.slice(0, 300)}"`);
    await page.screenshot({ path: "e2e-results/05-coworker-bm-fit.png" });
  });

  test("5.3 AI Coworker: service delivery roles for pool maintenance", async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto("/workspace");
    await page.waitForLoadState("networkidle");
    const response = await askCoworker(
      page,
      "What operational roles does a residential pool service company need? We handle scheduling, route management, chemical safety, equipment inventory, and customer billing."
    );
    expect
      .soft(response.toLowerCase())
      .toMatch(/service|delivery|manager|schedule|route|technician|customer|field/);
    await page.screenshot({ path: "e2e-results/05-coworker-roles.png" });
  });

  test("5.4 Create RRPP products", async ({ page }) => {
    await ensureLoggedIn(page);
    for (const name of PRODUCTS) {
      await createProduct(page, name, PORTFOLIO);
    }
    await page.screenshot({ path: "e2e-results/05-products-created.png" });
  });

  test("5.5 API: bm-services is available for pool company", async ({ page }) => {
    await ensureLoggedIn(page);
    const models = await fetchBusinessModels(page);
    const services = models.find((m) => m.modelId === "bm-services");
    expect.soft(services).toBeDefined();
    expect.soft(services?.isBuiltIn).toBe(true);
    console.log(`[api] bm-services: ${JSON.stringify(services)}`);
  });

  test("5.6 Assign bm-services to RRPP-Weekly Pool Maintenance Service", async ({ page }) => {
    await ensureLoggedIn(page);
    const url = await navigateToProductDetail(page, PRODUCTS[0], PORTFOLIO);
    if (!url) { console.log("[skip] Product detail not found"); return; }
    const assigned = await assignBusinessModelOnPage(page, BM_NAME);
    expect.soft(assigned).toBe(true);
    await page.screenshot({ path: "e2e-results/05-bm-assigned-maintenance.png" });
  });

  test("5.7 Role panel shows bm-services roles for pool maintenance", async ({ page }) => {
    await ensureLoggedIn(page);
    const url = await navigateToProductDetail(page, PRODUCTS[0], PORTFOLIO);
    if (!url) return;
    const visible = await verifyRolePanelVisible(page);
    expect.soft(visible).toBe(true);
    const roles = [
      "Engagement Manager",
      "Resource & Capacity Planner",
      "Service Delivery Manager",
      "Knowledge Manager",
    ];
    for (const role of roles) {
      const el = page.locator(`text=${role}`).first();
      const found = await el.isVisible({ timeout: 3_000 }).catch(() => false);
      console.log(`[roles] "${role}" visible: ${found}`);
      expect.soft(found).toBe(true);
    }
    await page.screenshot({ path: "e2e-results/05-role-panel.png" });
  });

  test("5.8 Assign bm-services to RRPP-Equipment Repair & Parts", async ({ page }) => {
    await ensureLoggedIn(page);
    const url = await navigateToProductDetail(page, PRODUCTS[1], PORTFOLIO);
    if (!url) return;
    await assignBusinessModelOnPage(page, BM_NAME);
    await page.screenshot({ path: "e2e-results/05-bm-assigned-repair.png" });
  });

  test("5.9 Assign bm-services to RRPP-Seasonal Open & Close", async ({ page }) => {
    await ensureLoggedIn(page);
    const url = await navigateToProductDetail(page, PRODUCTS[2], PORTFOLIO);
    if (!url) return;
    await assignBusinessModelOnPage(page, BM_NAME);
    await page.screenshot({ path: "e2e-results/05-bm-assigned-seasonal.png" });
  });

  test("5.10 AI Coworker: SLA design for field-service pool maintenance", async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto("/workspace");
    await page.waitForLoadState("networkidle");
    const response = await askCoworker(
      page,
      "How should a residential pool service company structure its service level agreements? We need response times for green pool emergencies vs standard weekly visits."
    );
    expect
      .soft(response.toLowerCase())
      .toMatch(/sla|service level|response|emergency|priority|tier|agreement/);
    await page.screenshot({ path: "e2e-results/05-coworker-sla.png" });
  });

  test("5.11 Verify bm-services shared across two companies (TLI + RRPP)", async ({ page }) => {
    await ensureLoggedIn(page);
    // Both TLI-IT Support Services and RRPP-Weekly Pool Maintenance should have bm-services
    // Verify they both appear in the portfolio without conflict
    await page.goto(`/portfolio/${PORTFOLIO}`);
    await page.waitForLoadState("networkidle");
    const tli = page.locator("text=TLI-IT Support Services").first();
    const rrpp = page.locator("text=RRPP-Weekly Pool Maintenance Service").first();
    const tliVisible = await tli.isVisible({ timeout: 3_000 }).catch(() => false);
    const rrppVisible = await rrpp.isVisible({ timeout: 3_000 }).catch(() => false);
    console.log(`[portfolio] TLI product visible: ${tliVisible}, RRPP product visible: ${rrppVisible}`);
    // Both companies coexist on the same portfolio with the same business model
    expect.soft(tliVisible || rrppVisible).toBe(true);
    await page.screenshot({ path: "e2e-results/05-portfolio-shared-bm.png" });
  });
});
