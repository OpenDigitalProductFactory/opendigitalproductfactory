/**
 * Suite 2: ManagingDigital — Digital Transformation Training
 * Business model: bm-media (Media / Content / Publishing)
 * Website: managingdigital.com
 *
 * Tests product creation for a digital training organisation, assignment of
 * bm-media, and AI Coworker guidance on content strategy and audience development.
 * Non-blocking: soft assertions throughout.
 */
import { test, expect } from "@playwright/test";
import { ensureLoggedIn } from "./helpers/auth";
import { resetTestData, seedTestProducts } from "./helpers/reset";
import { askCoworker, clearCoworker } from "./helpers/coworker";
import { createProduct, navigateToProductDetail } from "./helpers/products";
import {
  assignBusinessModelOnPage,
  verifyRolePanelVisible,
} from "./helpers/business-models";

const ORG = "ManagingDigital";
const PORTFOLIO = "for_employees";
const BM_NAME = "Media / Content / Publishing";
const PRODUCTS = [
  "MD-Digital Leadership Programme",
  "MD-AI Readiness Assessment",
  "MD-Executive Coaching",
];

test.beforeAll(() => {
  resetTestData();
  seedTestProducts();
});

test.describe(`Suite 2: ${ORG}`, () => {
  test("2.1 Auth session valid", async ({ page }) => {
    await ensureLoggedIn(page);
    await expect.soft(page).not.toHaveURL(/login/);
  });

  test("2.2 Navigate to For Employees portfolio", async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto(`/portfolio/${PORTFOLIO}`);
    await page.waitForLoadState("networkidle");
    await expect.soft(page).not.toHaveURL(/login/);
    await page.screenshot({ path: "e2e-results/02-portfolio-employees.png" });
  });

  test("2.3 AI Coworker: roles for digital training content products", async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto("/workspace");
    await page.waitForLoadState("networkidle");
    await clearCoworker(page);
    const response = await askCoworker(
      page,
      "What roles does a digital training organization need to manage content products?"
    );
    expect.soft(response.toLowerCase()).toMatch(/content|editorial|audience|strategy|manager/);
    await page.screenshot({ path: "e2e-results/02-coworker-roles.png" });
  });

  test("2.4 Create product: MD-Digital Leadership Programme", async ({ page }) => {
    await ensureLoggedIn(page);
    await createProduct(page, PRODUCTS[0], PORTFOLIO);
    await page.screenshot({ path: "e2e-results/02-product-leadership.png" });
  });

  test("2.5 Create product: MD-AI Readiness Assessment", async ({ page }) => {
    await ensureLoggedIn(page);
    await createProduct(page, PRODUCTS[1], PORTFOLIO);
    await page.screenshot({ path: "e2e-results/02-product-ai-readiness.png" });
  });

  test("2.6 Create product: MD-Executive Coaching", async ({ page }) => {
    await ensureLoggedIn(page);
    await createProduct(page, PRODUCTS[2], PORTFOLIO);
    await page.screenshot({ path: "e2e-results/02-product-coaching.png" });
  });

  test("2.7 Navigate to MD-Digital Leadership Programme detail", async ({ page }) => {
    await ensureLoggedIn(page);
    const url = await navigateToProductDetail(page, PRODUCTS[0], PORTFOLIO);
    expect.soft(url).toMatch(/\/portfolio\/product\//);
    await page.screenshot({ path: "e2e-results/02-product-detail.png" });
  });

  test("2.8 Assign bm-media to MD-Digital Leadership Programme", async ({ page }) => {
    await ensureLoggedIn(page);
    const url = await navigateToProductDetail(page, PRODUCTS[0], PORTFOLIO);
    if (!url) {
      console.log("[skip] Could not navigate to product detail");
      return;
    }
    const assigned = await assignBusinessModelOnPage(page, BM_NAME);
    expect.soft(assigned).toBe(true);
    await page.screenshot({ path: "e2e-results/02-bm-assigned.png" });
  });

  test("2.9 Role panel shows bm-media roles", async ({ page }) => {
    await ensureLoggedIn(page);
    const url = await navigateToProductDetail(page, PRODUCTS[0], PORTFOLIO);
    if (!url) return;
    const visible = await verifyRolePanelVisible(page);
    expect.soft(visible).toBe(true);
    const roles = [
      "Content Strategy Manager",
      "Audience Development Manager",
      "Rights & Licensing Manager",
      "Editorial Operations Manager",
    ];
    for (const role of roles) {
      const el = page.locator(`text=${role}`).first();
      const found = await el.isVisible({ timeout: 3_000 }).catch(() => false);
      console.log(`[roles] "${role}" visible: ${found}`);
      expect.soft(found).toBe(true);
    }
    await page.screenshot({ path: "e2e-results/02-role-panel.png" });
  });

  test("2.10 AI Coworker: audience development for leadership programme", async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto("/workspace");
    await page.waitForLoadState("networkidle");
    const response = await askCoworker(
      page,
      "How should we structure audience development for a digital leadership programme?"
    );
    expect.soft(response.toLowerCase()).toMatch(/audience|channel|subscriber|growth|completion|cohort|outcome/);
    await page.screenshot({ path: "e2e-results/02-coworker-audience.png" });
  });

  test("2.11 Assign bm-media to MD-AI Readiness Assessment", async ({ page }) => {
    await ensureLoggedIn(page);
    const url = await navigateToProductDetail(page, PRODUCTS[1], PORTFOLIO);
    if (!url) return;
    await assignBusinessModelOnPage(page, BM_NAME);
    await page.screenshot({ path: "e2e-results/02-product2-bm-assigned.png" });
  });

  test("2.12 Assign bm-media to MD-Executive Coaching", async ({ page }) => {
    await ensureLoggedIn(page);
    const url = await navigateToProductDetail(page, PRODUCTS[2], PORTFOLIO);
    if (!url) return;
    await assignBusinessModelOnPage(page, BM_NAME);
    await page.screenshot({ path: "e2e-results/02-product3-bm-assigned.png" });
  });
});
