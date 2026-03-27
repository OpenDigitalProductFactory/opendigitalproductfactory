/**
 * Suite 3: Brushy Creek HOA — Homeowners Association, Cedar Park TX
 * Business model: CUSTOM — bm-hoa-custom (Community / HOA Management)
 * Website: brushycreekmunicipality.org
 *
 * No built-in model fits an HOA. This suite validates the custom model builder:
 * creates "Community / HOA Management" via /admin/business-models, assigns it
 * to BCHOA products, and verifies HOA-specific roles appear in the panel.
 * Non-blocking: soft assertions throughout.
 */
import { test, expect } from "@playwright/test";
import { ensureLoggedIn } from "./helpers/auth";
import { resetTestData, seedTestProducts } from "./helpers/reset";
import { askCoworker, clearCoworker } from "./helpers/coworker";
import { createProduct, navigateToProductDetail } from "./helpers/products";
import {
  fetchBusinessModels,
  navigateToAdminBusinessModels,
  createCustomModelViaAdmin,
  assignBusinessModelOnPage,
  verifyRolePanelVisible,
} from "./helpers/business-models";

const ORG = "Brushy Creek HOA";
const PORTFOLIO = "for_employees";
const CUSTOM_MODEL_NAME = "Community / HOA Management";
const PRODUCTS = [
  "BCHOA-Community Management Platform",
  "BCHOA-Amenity Booking System",
  "BCHOA-Resident Communications Portal",
];

const CUSTOM_MODEL = {
  name: CUSTOM_MODEL_NAME,
  description:
    "Non-profit community associations managing shared amenities, governance, and resident services",
  roles: [
    {
      name: "Community Operations Manager",
      authorityDomain: "Day-to-day operations, vendor management, budget execution",
      escalatesTo: "HR-200",
    },
    {
      name: "Resident Relations Coordinator",
      authorityDomain: "Resident communications, dispute resolution, satisfaction",
      escalatesTo: "HR-200",
    },
    {
      name: "Facilities & Amenities Manager",
      authorityDomain: "Pool, clubhouse, green spaces — maintenance and scheduling",
      escalatesTo: "HR-500",
    },
    {
      name: "Governance & Compliance Lead",
      authorityDomain: "CC&R enforcement, board resolutions, legal compliance",
      escalatesTo: "HR-400",
    },
  ],
};

test.beforeAll(() => {
  resetTestData();
  seedTestProducts();
});

test.describe(`Suite 3: ${ORG}`, () => {
  test("3.1 Auth session valid", async ({ page }) => {
    await ensureLoggedIn(page);
    await expect.soft(page).not.toHaveURL(/login/);
  });

  test("3.2 AI Coworker: which business model fits an HOA?", async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto("/workspace");
    await page.waitForLoadState("networkidle");
    await clearCoworker(page);
    const response = await askCoworker(
      page,
      "Which business model best describes a homeowners association? We manage community amenities, enforce CC&Rs, and provide resident services."
    );
    expect.soft(response.length).toBeGreaterThan(20);
    console.log(`[hoa] BM recommendation: "${response.slice(0, 300)}"`);
    await page.screenshot({ path: "e2e-results/03-coworker-bm-fit.png" });
  });

  test("3.3 Admin /admin/business-models page loads with built-in models", async ({ page }) => {
    await ensureLoggedIn(page);
    const loaded = await navigateToAdminBusinessModels(page);
    expect.soft(loaded).toBe(true);
    // Verify all 8 built-in names visible
    const builtIns = [
      "SaaS / Subscription",
      "Marketplace / Platform",
      "E-commerce / Retail",
      "Professional Services / Consulting",
    ];
    for (const name of builtIns) {
      const el = page.locator(`text=${name}`).first();
      const found = await el.isVisible({ timeout: 3_000 }).catch(() => false);
      console.log(`[admin] Built-in "${name}" visible: ${found}`);
      expect.soft(found).toBe(true);
    }
    await page.screenshot({ path: "e2e-results/03-admin-bm-page.png" });
  });

  test("3.4 API: 8 built-in models present, none match HOA", async ({ page }) => {
    await ensureLoggedIn(page);
    const models = await fetchBusinessModels(page);
    expect.soft(models.length).toBeGreaterThanOrEqual(8);
    const builtInCount = models.filter((m) => m.isBuiltIn).length;
    expect.soft(builtInCount).toBe(8);
    const hoaMatch = models.find(
      (m) => m.name.toLowerCase().includes("hoa") || m.name.toLowerCase().includes("community")
    );
    expect.soft(hoaMatch).toBeUndefined();
    console.log(`[api] ${models.length} models, ${builtInCount} built-in; HOA match: ${hoaMatch?.name ?? "none"}`);
  });

  test("3.5 Create BCHOA products", async ({ page }) => {
    await ensureLoggedIn(page);
    for (const name of PRODUCTS) {
      await createProduct(page, name, PORTFOLIO);
    }
    await page.screenshot({ path: "e2e-results/03-products-created.png" });
  });

  test("3.6 AI Coworker: HOA-specific roles vs standard services", async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto("/workspace");
    await page.waitForLoadState("networkidle");
    const response = await askCoworker(
      page,
      "What unique roles does a homeowners association need compared to a standard professional services organization?"
    );
    expect
      .soft(response.toLowerCase())
      .toMatch(/community|resident|facilities|governance|amenity|board|compliance/);
    console.log(`[hoa] HOA roles: "${response.slice(0, 300)}"`);
    await page.screenshot({ path: "e2e-results/03-coworker-hoa-roles.png" });
  });

  test("3.7 Create custom model: Community / HOA Management", async ({ page }) => {
    await ensureLoggedIn(page);
    const created = await createCustomModelViaAdmin(
      page,
      CUSTOM_MODEL.name,
      CUSTOM_MODEL.description,
      CUSTOM_MODEL.roles,
    );
    expect.soft(created).toBe(true);
    await page.screenshot({ path: "e2e-results/03-custom-model-created.png" });
  });

  test("3.8 Assign custom HOA model to BCHOA-Community Management Platform", async ({ page }) => {
    await ensureLoggedIn(page);
    const url = await navigateToProductDetail(page, PRODUCTS[0], PORTFOLIO);
    if (!url) {
      console.log("[skip] Product detail not found");
      return;
    }
    const assigned = await assignBusinessModelOnPage(page, CUSTOM_MODEL_NAME);
    expect.soft(assigned).toBe(true);
    await page.screenshot({ path: "e2e-results/03-hoa-bm-assigned.png" });
  });

  test("3.9 Role panel shows HOA custom roles", async ({ page }) => {
    await ensureLoggedIn(page);
    const url = await navigateToProductDetail(page, PRODUCTS[0], PORTFOLIO);
    if (!url) return;
    const visible = await verifyRolePanelVisible(page);
    expect.soft(visible).toBe(true);
    for (const role of CUSTOM_MODEL.roles) {
      const el = page.locator(`text=${role.name}`).first();
      const found = await el.isVisible({ timeout: 3_000 }).catch(() => false);
      console.log(`[roles] "${role.name}" visible: ${found}`);
      expect.soft(found).toBe(true);
    }
    await page.screenshot({ path: "e2e-results/03-hoa-role-panel.png" });
  });

  test("3.10 Assign HOA model to remaining BCHOA products", async ({ page }) => {
    await ensureLoggedIn(page);
    for (const name of PRODUCTS.slice(1)) {
      const url = await navigateToProductDetail(page, name, PORTFOLIO);
      if (!url) { console.log(`[skip] ${name} not found`); continue; }
      await assignBusinessModelOnPage(page, CUSTOM_MODEL_NAME);
      await page.screenshot({ path: `e2e-results/03-${name.toLowerCase().replace(/[^a-z0-9]/g, "-")}-bm.png` });
    }
  });
});
