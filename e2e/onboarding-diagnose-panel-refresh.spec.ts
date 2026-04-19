/**
 * Diagnostic test: load /build, refresh, capture browser console + panel state.
 * Non-persistent probe — delete after root cause is identified.
 */
import { test, type Page } from "@playwright/test";

const ADMIN_EMAIL = "admin@dpf.local";
const ADMIN_PASSWORD = process.env.DPF_ADMIN_PASSWORD || "changeme123";

test("diagnose: /build coworker panel state on refresh", async ({ page }) => {
  test.setTimeout(120_000);

  const consoleLines: string[] = [];
  page.on("console", (msg) => {
    consoleLines.push(`[${msg.type()}] ${msg.text()}`);
  });
  page.on("pageerror", (err) => {
    consoleLines.push(`[pageerror] ${err.message}`);
  });

  // 1. Sign in
  await page.goto("/login");
  await page.waitForSelector('input[name="email"]', { timeout: 15_000 });
  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', ADMIN_PASSWORD);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);

  // 2. Open /build. Skip networkidle — the agent's SSE stream keeps the
  //    network busy indefinitely while processing.
  await page.goto("/build", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-agent-panel="true"]', { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(10_000); // give Shell time to fetch snapshot

  console.log("\n=== After first load ===");
  await dumpPanelState(page);
  console.log("\n=== Console events (first load) ===");
  for (const l of consoleLines) console.log("  " + l);
  await page.screenshot({ path: "e2e-report/diagnose-panel-first-load.png", fullPage: true });

  // 3. Hard reload
  consoleLines.length = 0;
  console.log("\n=== Reloading ===");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(10_000); // give Shell time to re-fetch

  console.log("\n=== After refresh ===");
  await dumpPanelState(page);
  console.log("\n=== Console events (after refresh) ===");
  for (const l of consoleLines) console.log("  " + l);
  await page.screenshot({ path: "e2e-report/diagnose-panel-after-refresh.png", fullPage: true });
});

async function dumpPanelState(page: Page): Promise<void> {
  const state = await page.evaluate(() => {
    const panel = document.querySelector('[data-agent-panel="true"]');
    if (!panel) return { panelExists: false };
    const bubbles = panel.querySelectorAll('[data-testid="agent-message"]');
    const assistantBubbles = panel.querySelectorAll('[data-testid="agent-message"][data-message-role="assistant"]');
    const userBubbles = panel.querySelectorAll('[data-testid="agent-message"][data-message-role="user"]');
    const textarea = panel.querySelector("textarea") as HTMLTextAreaElement | null;
    const textareaEnabled = textarea ? !textarea.disabled : null;
    // Grab the first 200 chars of the first bubble if any
    const firstBubbleText = bubbles[0]?.textContent?.trim().slice(0, 200) ?? null;
    return {
      panelExists: true,
      totalBubbles: bubbles.length,
      userBubbles: userBubbles.length,
      assistantBubbles: assistantBubbles.length,
      textareaEnabled,
      firstBubbleText,
    };
  });
  console.log(JSON.stringify(state, null, 2));
}
