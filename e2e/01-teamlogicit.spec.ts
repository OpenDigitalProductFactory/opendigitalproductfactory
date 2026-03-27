/**
 * Suite 1: TeamLogicIT — IT Managed Services, Round Rock TX
 * Business model: bm-services (Professional Services / Consulting)
 * Website: teamlogic.com/locations/round-rock-tx
 *
 * Tests product creation, business model assignment (bm-services),
 * role panel visibility, and AI Coworker guidance for a managed IT provider.
 * Non-blocking: soft assertions throughout.
 */
import { test, expect } from "@playwright/test";
import { login, ensureLoggedIn } from "./helpers/auth";
import { resetTestData, seedTestProducts, verifyBacklogEpicPresent } from "./helpers/reset";
import { askCoworker, clearCoworker } from "./helpers/coworker";
import { createProduct, navigateToProductDetail } from "./helpers/products";
import {
  fetchBusinessModels,
  assignBusinessModelOnPage,
  verifyRolePanelVisible,
} from "./helpers/business-models";

const ORG = "TeamLogicIT";
const PORTFOLIO = "products_and_services_sold";
const BM_NAME = "Professional Services / Consulting";
const PRODUCTS = [
  "TLI-IT Support Services",
  "TLI-Network Infrastructure Management",
  "TLI-Cybersecurity Advisory",
];

test.beforeAll(() => {
  resetTestData();
  seedTestProducts();
});

test.describe(`Suite 1: ${ORG}`, () => {
  test("1.1 Login as admin", async ({ page }) => {
    await login(page);
    await expect.soft(page).not.toHaveURL(/login/);
    await expect.soft(page.locator("body")).toBeVisible();
  });

  test("1.2 Workspace loads", async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto("/workspace");
    await page.waitForLoadState("networkidle");
    await expect.soft(page).toHaveURL(/workspace/);
    await page.screenshot({ path: "e2e-results/01-workspace.png" });
  });

  test("1.3 AI Coworker: service delivery roles for managed IT", async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto("/workspace");
    await page.waitForLoadState("networkidle");
    await clearCoworker(page);
    const response = await askCoworker(
      page,
      "What service delivery roles does a managed IT service provider need?"
    );
    expect.soft(response.toLowerCase()).toMatch(/service|delivery|manager|engagement|support|itil/);
    await page.screenshot({ path: "e2e-results/01-coworker-roles.png" });
  });

  test("1.4 Create product: TLI-IT Support Services", async ({ page }) => {
    await ensureLoggedIn(page);
    const url = await createProduct(page, PRODUCTS[0], PORTFOLIO);
    if (!url) console.log("[skip] Product creation UI not found — may already exist");
    await page.screenshot({ path: "e2e-results/01-product-it-support.png" });
  });

  test("1.5 Create product: TLI-Network Infrastructure Management", async ({ page }) => {
    await ensureLoggedIn(page);
    await createProduct(page, PRODUCTS[1], PORTFOLIO);
    await page.screenshot({ path: "e2e-results/01-product-network.png" });
  });

  test("1.6 Create product: TLI-Cybersecurity Advisory", async ({ page }) => {
    await ensureLoggedIn(page);
    await createProduct(page, PRODUCTS[2], PORTFOLIO);
    await page.screenshot({ path: "e2e-results/01-product-cyber.png" });
  });

  test("1.7 Navigate to portfolio: Products & Services Sold", async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto(`/portfolio/${PORTFOLIO}`);
    await page.waitForLoadState("networkidle");
    await expect.soft(page).not.toHaveURL(/login/);
    await page.screenshot({ path: "e2e-results/01-portfolio.png" });
  });

  test("1.8 Navigate to TLI product detail page", async ({ page }) => {
    await ensureLoggedIn(page);
    const url = await navigateToProductDetail(page, PRODUCTS[0], PORTFOLIO);
    expect.soft(url).toMatch(/\/portfolio\/product\//);
    await page.screenshot({ path: "e2e-results/01-product-detail.png" });
  });

  test("1.9 Assign bm-services to TLI-IT Support Services", async ({ page }) => {
    await ensureLoggedIn(page);
    const url = await navigateToProductDetail(page, PRODUCTS[0], PORTFOLIO);
    if (!url) {
      console.log("[skip] Could not navigate to product detail — skipping BM assignment");
      return;
    }
    const assigned = await assignBusinessModelOnPage(page, BM_NAME);
    expect.soft(assigned).toBe(true);
    await page.screenshot({ path: "e2e-results/01-bm-assigned.png" });
  });

  test("1.10 Role Assignments panel visible after bm-services assignment", async ({ page }) => {
    await ensureLoggedIn(page);
    const url = await navigateToProductDetail(page, PRODUCTS[0], PORTFOLIO);
    if (!url) return;
    const visible = await verifyRolePanelVisible(page);
    expect.soft(visible).toBe(true);
    // Verify expected role names appear in the panel
    const roles = ["Engagement Manager", "Service Delivery Manager", "Resource & Capacity Planner", "Knowledge Manager"];
    for (const role of roles) {
      const el = page.locator(`text=${role}`).first();
      const found = await el.isVisible({ timeout: 3_000 }).catch(() => false);
      console.log(`[roles] "${role}" visible: ${found}`);
      expect.soft(found).toBe(true);
    }
    await page.screenshot({ path: "e2e-results/01-role-panel.png" });
  });

  test("1.11 API: GET /api/v1/business-models returns bm-services", async ({ page }) => {
    await ensureLoggedIn(page);
    const models = await fetchBusinessModels(page);
    expect.soft(models.length).toBeGreaterThanOrEqual(8);
    const services = models.find((m) => m.modelId === "bm-services");
    expect.soft(services).toBeDefined();
    expect.soft(services?.isBuiltIn).toBe(true);
    console.log(`[api] Found ${models.length} models; bm-services: ${JSON.stringify(services)}`);
  });

  test("1.12 AI Coworker: SLA framework for IT engagement model", async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto("/workspace");
    await page.waitForLoadState("networkidle");
    const response = await askCoworker(
      page,
      "What SLA framework suits a managed IT engagement model?"
    );
    expect.soft(response.toLowerCase()).toMatch(/sla|service level|itil|response|tier|escalat/);
    await page.screenshot({ path: "e2e-results/01-coworker-sla.png" });
  });

  test("1.13 Authority Matrix page loads", async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto("/platform/ai/authority");
    await page.waitForLoadState("networkidle");
    await expect.soft(page).not.toHaveURL(/login/);
    await page.screenshot({ path: "e2e-results/01-authority-matrix.png" });
  });

  test("1.14 EP-BIZ-ROLES epic present in backlog", async ({ page }) => {
    await ensureLoggedIn(page);
    const present = await verifyBacklogEpicPresent(page);
    expect.soft(present).toBe(true);
    await page.screenshot({ path: "e2e-results/01-backlog-epic.png" });
  });
});
