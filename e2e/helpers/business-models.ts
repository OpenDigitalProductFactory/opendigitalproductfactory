import { Page } from "@playwright/test";

export type BusinessModel = {
  modelId: string;
  name: string;
  isBuiltIn: boolean;
  roles?: Array<{ roleId: string; name: string }>;
};

export async function fetchBusinessModels(page: Page): Promise<BusinessModel[]> {
  try {
    const response = await page.request.get("/api/v1/business-models");
    if (!response.ok()) {
      console.log(`[bm-api] GET /api/v1/business-models → ${response.status()} (GAP-002)`);
      return [];
    }
    const body = await response.json();
    return body.data ?? body.business_models ?? body.models ?? body ?? [];
  } catch (err) {
    console.log(`[bm-api] Error: ${(err as Error).message}`);
    return [];
  }
}

export async function assignBusinessModelOnPage(
  page: Page,
  modelName: string
): Promise<boolean> {
  // Selector: <select> with placeholder "→ Assign business model…"
  // Option labels include role count, e.g. "Professional Services / Consulting (4 roles)"
  const selector = page
    .locator('select')
    .filter({ has: page.locator('option:has-text("Assign business model")') })
    .first();

  if (!(await selector.isVisible({ timeout: 5_000 }).catch(() => false))) {
    console.log(`[gap] GAP-001: Business Model selector absent`);
    return false;
  }

  // Use evaluate for partial-label matching (option text includes role count suffix)
  const selected = await page.evaluate((name) => {
    const selects = Array.from(document.querySelectorAll("select"));
    const sel = selects.find((s) =>
      Array.from(s.options).some((o) => o.text.includes("Assign business model"))
    );
    if (!sel) return false;
    const opt = Array.from(sel.options).find((o) => o.text.includes(name));
    if (!opt) return false;
    sel.value = opt.value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, modelName);

  if (!selected) {
    console.log(`[bm] Option for "${modelName}" not found in selector`);
    return false;
  }

  // Wait for server action to complete (page re-render)
  await page.waitForTimeout(1_500);
  return true;
}

export async function verifyRolePanelVisible(page: Page): Promise<boolean> {
  // The Role Assignments <h2> is always present on the product detail page.
  // The content shows either roles or a "no model" message.
  const heading = page.getByRole("heading", { name: "Role Assignments" });
  const visible = await heading.isVisible({ timeout: 4_000 }).catch(() => false);
  if (!visible) {
    console.log(`[gap] GAP-005: Role Assignments heading absent`);
  }
  return visible;
}

export type RoleDef = {
  name: string;
  authorityDomain?: string;
  escalatesTo?: string;
};

/**
 * Navigate to /admin/business-models and verify the built-in section loads.
 */
export async function navigateToAdminBusinessModels(page: Page): Promise<boolean> {
  try {
    await page.goto("/admin/business-models");
    await page.waitForLoadState("networkidle", { timeout: 8_000 });
    if (page.url().includes("/login")) return false;
    // Heading is "Built-in templates (N)" — use partial text match
    const heading = page.locator("h2").filter({ hasText: "Built-in templates" }).first();
    const visible = await heading.isVisible({ timeout: 5_000 }).catch(() => false);
    console.log(`[bm-admin] Admin page loaded, built-in section visible: ${visible}`);
    return visible;
  } catch (err) {
    console.warn(`[bm-admin] navigateToAdminBusinessModels error: ${(err as Error).message}`);
    return false;
  }
}

/**
 * Create a custom business model via the admin UI at /admin/business-models.
 * Returns true if the model name appears in the list after submission.
 * Non-blocking — returns false with a warning on any error.
 */
export async function createCustomModelViaAdmin(
  page: Page,
  name: string,
  description: string,
  roles: RoleDef[],
): Promise<boolean> {
  try {
    await page.goto("/admin/business-models");
    await page.waitForLoadState("networkidle", { timeout: 8_000 });

    // Button text is "+ New business model"
    const newBtn = page.locator("button").filter({ hasText: "New business model" }).first();
    if (!(await newBtn.isVisible({ timeout: 5_000 }).catch(() => false))) {
      console.warn("[bm-admin] '+ New business model' button not found");
      return false;
    }
    await newBtn.click();
    await page.waitForTimeout(400);

    // Name field — target by placeholder to avoid nth(0) fragility
    const nameInput = page
      .locator('input[placeholder*="Subscription Commerce"], input[placeholder*="business model" i]')
      .first();
    const nameInputFallback = page.locator("input").nth(0);
    const nameTarget = (await nameInput.isVisible({ timeout: 2_000 }).catch(() => false))
      ? nameInput
      : nameInputFallback;
    await nameTarget.fill(name);

    // Description field — textarea or input
    const descInput = page
      .locator('input[placeholder*="description" i], textarea[placeholder*="description" i]')
      .first();
    if (await descInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await descInput.fill(description);
    }

    // First role is pre-populated — fill it (placeholder: "e.g. Customer Success Manager")
    if (roles.length > 0) {
      const roleInputs = page.locator("input[placeholder*='Customer Success Manager']");
      const first = roleInputs.first();
      if (await first.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await first.fill(roles[0].name);
      }
    }

    // Add remaining roles — button text is "+ Add role"
    for (let i = 1; i < roles.length; i++) {
      const addBtn = page.locator("button").filter({ hasText: "+ Add role" }).first();
      if (await addBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await addBtn.click();
        await page.waitForTimeout(200);
      }
      const roleInputs = page.locator("input[placeholder*='Customer Success Manager']");
      const count = await roleInputs.count();
      if (count > 0) {
        await roleInputs.nth(count - 1).fill(roles[i].name);
      }
    }

    // Submit button text: "Create" (not "Cancel")
    const createBtn = page.locator("button").filter({ hasText: /^Create$/ }).first();
    if (!(await createBtn.isVisible({ timeout: 3_000 }).catch(() => false))) {
      console.warn("[bm-admin] Create button not found");
      return false;
    }
    await createBtn.click();

    // Wait for form to close (the "Create Custom Business Model" heading disappears)
    // then wait for the model name to appear in the rebuilt list.
    await page
      .locator('h2:has-text("Create Custom Business Model"), h3:has-text("Create Custom Business Model")')
      .waitFor({ state: "detached", timeout: 20_000 })
      .catch(() => {});

    // Fallback: also wait for the Built-in templates heading to return (list view restored)
    await page
      .locator("h2")
      .filter({ hasText: "Built-in templates" })
      .waitFor({ state: "visible", timeout: 10_000 })
      .catch(() => {});

    const card = page.locator(`text=${name}`).first();
    const created = await card.waitFor({ state: "visible", timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    console.log(`[bm-admin] Custom model "${name}" created: ${created}`);
    return created;
  } catch (err) {
    console.warn(`[bm-admin] createCustomModelViaAdmin error: ${(err as Error).message}`);
    return false;
  }
}
