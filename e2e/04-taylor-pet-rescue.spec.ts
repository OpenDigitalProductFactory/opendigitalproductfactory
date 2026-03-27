/**
 * Suite 4: Taylor Pet Rescue — Non-Profit Animal Rescue, Taylor TX
 * Business model: CUSTOM — bm-nonprofit-rescue (Non-Profit Animal Rescue)
 * Website: taylorpetrescue.org
 *
 * No built-in model fits a non-profit rescue org. This suite creates a custom
 * "Non-Profit Animal Rescue" model and assigns it to TPR digital products
 * (adoption portal, foster management app, fundraising platform).
 * Non-blocking: soft assertions throughout.
 */
import { test, expect } from "@playwright/test";
import { ensureLoggedIn } from "./helpers/auth";
import { resetTestData, seedTestProducts } from "./helpers/reset";
import { askCoworker, clearCoworker } from "./helpers/coworker";
import { createProduct, navigateToProductDetail } from "./helpers/products";
import {
  createCustomModelViaAdmin,
  assignBusinessModelOnPage,
  verifyRolePanelVisible,
} from "./helpers/business-models";

const ORG = "Taylor Pet Rescue";
const PORTFOLIO = "manufacturing_and_delivery";
const CUSTOM_MODEL_NAME = "Non-Profit Animal Rescue";
const PRODUCTS = [
  "TPR-Pet Adoption Portal",
  "TPR-Foster Network Management",
  "TPR-Fundraising & Donor Platform",
];

const CUSTOM_MODEL = {
  name: CUSTOM_MODEL_NAME,
  description:
    "Non-profit organisations rescuing, fostering, and rehoming companion animals — volunteer-driven, donation-funded",
  roles: [
    {
      name: "Rescue Operations Manager",
      authorityDomain: "Animal intake, medical triage, transport coordination, capacity management",
      escalatesTo: "HR-200",
    },
    {
      name: "Foster Network Coordinator",
      authorityDomain: "Foster home recruitment, placement matching, home visits, foster retention",
      escalatesTo: "HR-200",
    },
    {
      name: "Community Engagement & Fundraising Manager",
      authorityDomain: "Donor cultivation, event fundraising, grant applications, social media campaigns",
      escalatesTo: "HR-400",
    },
    {
      name: "Volunteer & Adoption Coordinator",
      authorityDomain: "Volunteer onboarding, adoption screening, applicant communications, post-adoption follow-up",
      escalatesTo: "HR-500",
    },
  ],
};

test.beforeAll(() => {
  resetTestData();
  seedTestProducts();
});

test.describe(`Suite 4: ${ORG}`, () => {
  test("4.1 Auth session valid", async ({ page }) => {
    await ensureLoggedIn(page);
    await expect.soft(page).not.toHaveURL(/login/);
  });

  test("4.2 AI Coworker: what business model fits a pet rescue org?", async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto("/workspace");
    await page.waitForLoadState("networkidle");
    await clearCoworker(page);
    const response = await askCoworker(
      page,
      "We run a non-profit animal rescue — we take in stray and surrendered pets, place them in foster homes, and facilitate adoptions. Which business model best describes us?"
    );
    expect.soft(response.length).toBeGreaterThan(20);
    console.log(`[tpr] BM recommendation: "${response.slice(0, 300)}"`);
    await page.screenshot({ path: "e2e-results/04-coworker-bm-fit.png" });
  });

  test("4.3 AI Coworker: roles for an animal rescue digital platform", async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto("/workspace");
    await page.waitForLoadState("networkidle");
    const response = await askCoworker(
      page,
      "What operational roles does a non-profit animal rescue need to run a digital adoption and foster management platform?"
    );
    expect
      .soft(response.toLowerCase())
      .toMatch(/rescue|foster|adopt|volunteer|donor|community|coordinator/);
    await page.screenshot({ path: "e2e-results/04-coworker-roles.png" });
  });

  test("4.4 Create TPR products", async ({ page }) => {
    await ensureLoggedIn(page);
    for (const name of PRODUCTS) {
      await createProduct(page, name, PORTFOLIO);
    }
    await page.screenshot({ path: "e2e-results/04-products-created.png" });
  });

  test("4.5 Create custom model: Non-Profit Animal Rescue", async ({ page }) => {
    await ensureLoggedIn(page);
    const created = await createCustomModelViaAdmin(
      page,
      CUSTOM_MODEL.name,
      CUSTOM_MODEL.description,
      CUSTOM_MODEL.roles,
    );
    expect.soft(created).toBe(true);
    await page.screenshot({ path: "e2e-results/04-custom-model-created.png" });
  });

  test("4.6 Assign Non-Profit Animal Rescue model to TPR-Pet Adoption Portal", async ({ page }) => {
    await ensureLoggedIn(page);
    const url = await navigateToProductDetail(page, PRODUCTS[0], PORTFOLIO);
    if (!url) { console.log("[skip] Product detail not found"); return; }
    const assigned = await assignBusinessModelOnPage(page, CUSTOM_MODEL_NAME);
    expect.soft(assigned).toBe(true);
    await page.screenshot({ path: "e2e-results/04-bm-assigned-portal.png" });
  });

  test("4.7 Role panel shows rescue-specific roles on adoption portal", async ({ page }) => {
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
    await page.screenshot({ path: "e2e-results/04-role-panel.png" });
  });

  test("4.8 Assign model to TPR-Foster Network Management", async ({ page }) => {
    await ensureLoggedIn(page);
    const url = await navigateToProductDetail(page, PRODUCTS[1], PORTFOLIO);
    if (!url) return;
    await assignBusinessModelOnPage(page, CUSTOM_MODEL_NAME);
    await page.screenshot({ path: "e2e-results/04-bm-assigned-foster.png" });
  });

  test("4.9 Assign model to TPR-Fundraising & Donor Platform", async ({ page }) => {
    await ensureLoggedIn(page);
    const url = await navigateToProductDetail(page, PRODUCTS[2], PORTFOLIO);
    if (!url) return;
    await assignBusinessModelOnPage(page, CUSTOM_MODEL_NAME);
    await page.screenshot({ path: "e2e-results/04-bm-assigned-fundraising.png" });
  });

  test("4.10 AI Coworker: grant writing strategy for rescue org", async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto("/workspace");
    await page.waitForLoadState("networkidle");
    const response = await askCoworker(
      page,
      "What grant funding strategies work best for a small animal rescue organisation in Texas?"
    );
    expect
      .soft(response.toLowerCase())
      .toMatch(/grant|fund|donor|non-?profit|community|animal|rescue/);
    await page.screenshot({ path: "e2e-results/04-coworker-grants.png" });
  });
});
