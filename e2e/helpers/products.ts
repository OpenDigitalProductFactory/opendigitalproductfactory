import { Page } from "@playwright/test";
import { execSync } from "child_process";

/**
 * Create a digital product via direct SQL (reliable fallback for missing UI).
 * Uses docker exec psql — same pattern as resetTestData.
 * Sets lifecycleStatus=active so the product shows up in portfolio views.
 */
function createProductSQL(name: string, portfolioSlug: string): void {
  const safeName = name.replace(/'/g, "''");
  const safeSlug = portfolioSlug.replace(/'/g, "''");
  // productId derived from name (first 30 chars, letters/digits/dashes only)
  const productId = ("TEST-" + name.replace(/[^A-Za-z0-9]/g, "-").substring(0, 25)).toUpperCase();

  const sql = [
    `INSERT INTO "DigitalProduct" (id, "productId", name, "taxonomyNodeId", "lifecycleStatus", version, "createdAt", "updatedAt")`,
    `SELECT`,
    `  'ctest' || replace(gen_random_uuid()::text, '-', ''),`,
    `  '${productId}',`,
    `  '${safeName}',`,
    `  (SELECT id FROM "TaxonomyNode" WHERE "nodeId" = '${safeSlug}' LIMIT 1),`,
    `  'active', '1.0.0', now(), now()`,
    `WHERE NOT EXISTS (SELECT 1 FROM "DigitalProduct" WHERE name = '${safeName}');`,
  ].join(" ");

  try {
    execSync("docker exec -i dpf-postgres-1 psql -U dpf -d dpf", {
      input: sql,
      stdio: ["pipe", "pipe", "pipe"],
    });
    console.log(`[products] SQL created "${name}" in portfolio "${portfolioSlug}"`);
  } catch (err) {
    console.warn(`[products] SQL create failed for "${name}": ${(err as Error).message}`);
  }
}

/**
 * Attempt to create a digital product — tries UI first, falls back to SQL.
 * Non-blocking — logs and continues if creation flow not found.
 * Returns the product page URL if UI creation succeeded, "sql-created" if SQL was used, null on error.
 */
export async function createProduct(
  page: Page,
  name: string,
  portfolioSlug: string = "products_and_services_sold"
): Promise<string | null> {
  try {
    // Try navigating to a portfolio page that has a create action
    await page.goto(`/portfolio/${portfolioSlug}`);
    await page.waitForLoadState("networkidle", { timeout: 8_000 });

    // Look for a create / add product button
    const createBtn = page.locator(
      'button:has-text("Add"), button:has-text("New"), button:has-text("Create"), [aria-label*="create" i]'
    ).first();

    if (!(await createBtn.isVisible({ timeout: 3_000 }).catch(() => false))) {
      console.warn(`[products] No create button found on /portfolio/${portfolioSlug} for "${name}" — using SQL fallback`);
      createProductSQL(name, portfolioSlug);
      return "sql-created";
    }

    await createBtn.click();
    await page.waitForTimeout(500);

    // Fill product name
    const nameInput = page.locator('input[name="name"], input[placeholder*="name" i], input[placeholder*="product" i]').first();
    if (!(await nameInput.isVisible({ timeout: 3_000 }).catch(() => false))) {
      console.warn(`[products] Name input not found for "${name}" — using SQL fallback`);
      createProductSQL(name, portfolioSlug);
      return "sql-created";
    }
    await nameInput.fill(name);

    // Submit
    const submitBtn = page.locator('button[type="submit"]:has-text("Create"), button:has-text("Save"), button:has-text("Add")').first();
    if (await submitBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await submitBtn.click();
    }

    await page.waitForLoadState("networkidle", { timeout: 8_000 });
    const currentUrl = page.url();
    console.log(`[products] Created "${name}" via UI — navigated to ${currentUrl}`);
    return currentUrl;
  } catch (err) {
    console.warn(`[products] Error creating "${name}": ${(err as Error).message} — using SQL fallback`);
    createProductSQL(name, portfolioSlug);
    return "sql-created";
  }
}

/**
 * Check if a Business Model selector exists on the current product detail page.
 * Returns true/false.
 */
export async function checkBusinessModelSelector(page: Page, productName: string): Promise<boolean> {
  const selector = page
    .locator("select")
    .filter({ has: page.locator("option:has-text('Assign business model')") })
    .or(
      page.locator(
        '[data-testid="business-model-selector"], select:near(:text("Business Model")), [aria-label*="business model" i]',
      ),
    )
    .first();

  const present = await selector.isVisible({ timeout: 3_000 }).catch(() => false);
  if (!present) {
    console.log(`[bm] Business Model selector not found for "${productName}"`);
  }
  return present;
}

/**
 * Navigate to a product's detail page by clicking its link from the portfolio list.
 * Returns the detail page URL, or null if the product link is not found.
 */
export async function navigateToProductDetail(
  page: Page,
  productName: string,
  portfolioSlug: string,
): Promise<string | null> {
  try {
    await page.goto(`/portfolio/${portfolioSlug}`);
    await page.waitForLoadState("networkidle", { timeout: 8_000 });

    // Target product card links specifically (href contains /portfolio/product/) to
    // avoid matching breadcrumb or nav links that happen to contain the product name.
    const link = page
      .locator('a[href*="/portfolio/product/"]')
      .filter({ hasText: productName })
      .first();

    if (!(await link.isVisible({ timeout: 5_000 }).catch(() => false))) {
      console.warn(`[products] Product link not found for "${productName}"`);
      return null;
    }

    // Use waitForURL alongside click — waitForLoadState has a race condition with
    // Next.js client-side navigation where the network may already be idle.
    await Promise.all([
      page.waitForURL((url) => url.pathname.startsWith("/portfolio/product/"), { timeout: 10_000 }),
      link.click(),
    ]);

    const url = page.url();
    console.log(`[products] Product detail URL: ${url}`);
    return url;
  } catch (err) {
    console.warn(`[products] navigateToProductDetail error: ${(err as Error).message}`);
    return null;
  }
}
