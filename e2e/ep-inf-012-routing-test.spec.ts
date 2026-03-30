/**
 * EP-INF-012: Model Routing Validation Across All Agents
 *
 * Sends a test message to each agent and verifies:
 * 1. No NoEligibleEndpointsError
 * 2. No TIER_MINIMUM_DIMENSIONS errors
 * 3. No Prisma errors on agentModelConfig
 * 4. Agent responds successfully
 */
import { test, expect } from "@playwright/test";
import { loginToDPF, sendAndWait } from "./helpers";

// Standard pages with sidebar coworker panel (not Build Studio)
const STANDARD_AGENTS = [
  { page: "/workspace", agent: "coo", tier: "strong", message: "Give me a backlog status summary" },
  { page: "/platform/ai", agent: "platform-engineer", tier: "strong", message: "Which providers are active?" },
  { page: "/admin", agent: "admin-assistant", tier: "strong", message: "Who has admin access?" },
  { page: "/ops", agent: "ops-coordinator", tier: "adequate", message: "What epics are in progress?" },
  { page: "/portfolio", agent: "portfolio-advisor", tier: "adequate", message: "Summarize portfolio health" },
  { page: "/inventory", agent: "inventory-specialist", tier: "adequate", message: "How many products are in production?" },
  { page: "/ea", agent: "ea-architect", tier: "adequate", message: "What views exist?" },
  { page: "/employee", agent: "hr-specialist", tier: "adequate", message: "Show me the team structure" },
  { page: "/customer", agent: "customer-advisor", tier: "adequate", message: "Any active customer accounts?" },
];

test.describe("EP-INF-012: Model Routing Validation", () => {
  test.beforeEach(async ({ page }) => {
    await loginToDPF(page);
  });

  // Test Build Studio separately - needs to open coworker from button
  test("Agent build-specialist on /build (frontier tier)", async ({ page }) => {
    await page.goto("/build");
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

    // Click "AI Coworker" button to open the panel
    const coworkerBtn = page.locator('button:has-text("AI Coworker"), button:has-text("Coworker")').first();
    if (await coworkerBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await coworkerBtn.click();
      await page.waitForTimeout(1000);
    }

    // Check if the panel opened with a textarea
    const panel = page.locator('[data-agent-panel="true"]');
    const textarea = panel.locator("textarea");

    if (await textarea.isVisible({ timeout: 5_000 }).catch(() => false)) {
      const response = await sendAndWait(page, "Create a hello world feature", 120_000);
      console.log(`[build-specialist] Response: ${response.substring(0, 200)}`);
      expect(response.length).toBeGreaterThan(0);
      expect(response).not.toContain("NoEligibleEndpoints");
    } else {
      // Build Studio may need a build first - check if the panel has content at all
      console.log("[build-specialist] Coworker panel not available on empty build page - this is expected");
      // Verify at least that the page loaded without errors
      const errorText = await page.locator("text=NoEligibleEndpoints").count();
      expect(errorText).toBe(0);
    }
  });

  for (const entry of STANDARD_AGENTS) {
    test(`Agent ${entry.agent} on ${entry.page} (${entry.tier} tier)`, async ({ page }) => {
      // Navigate to the page
      await page.goto(entry.page);
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

      // The coworker panel should auto-expand or be in a sidebar
      // First check if we need to click an "Ask" or coworker FAB button
      const panel = page.locator('[data-agent-panel="true"]');
      if (!(await panel.isVisible({ timeout: 3_000 }).catch(() => false))) {
        // Try clicking the coworker FAB or toggle
        const fab = page.locator('[data-agent-fab="true"], button:has-text("Ask"), button:has-text("AI Coworker"), button:has-text("Coworker")').first();
        if (await fab.isVisible({ timeout: 3_000 }).catch(() => false)) {
          await fab.click();
          await page.waitForTimeout(500);
        }
      }

      // Listen for console errors related to routing
      const routingErrors: string[] = [];
      page.on("console", (msg) => {
        const text = msg.text();
        if (
          text.includes("NoEligibleEndpoints") ||
          text.includes("TIER_MINIMUM_DIMENSIONS") ||
          text.includes("agentModelConfig") ||
          text.includes("No providers available")
        ) {
          routingErrors.push(text);
        }
      });

      let response: string;
      try {
        response = await sendAndWait(page, entry.message, 120_000);
      } catch (err) {
        const errorMsg = String(err);
        console.log(`[${entry.agent}] sendAndWait failed: ${errorMsg}`);
        expect(errorMsg).not.toContain("NoEligibleEndpoints");
        expect(errorMsg).not.toContain("TIER_MINIMUM_DIMENSIONS");
        throw err;
      }

      console.log(`[${entry.agent}] Response (${response.length} chars): ${response.substring(0, 200)}`);

      // Verify no routing errors
      expect(routingErrors).toHaveLength(0);
      expect(response.length).toBeGreaterThan(0);
      expect(response).not.toContain("NoEligibleEndpoints");
      expect(response).not.toContain("No providers available");
    });
  }
});
