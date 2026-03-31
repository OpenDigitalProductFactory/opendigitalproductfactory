/**
 * Shared e2e test helpers for Build Studio tests.
 *
 * The AI coworker is asynchronous — after sending a message or approving a
 * proposal, the coworker processes in the background while the textarea is
 * disabled.  These helpers use the textarea's `disabled` property as the
 * primary idle signal, not placeholder text, which is more reliable.
 */
import type { Page } from "@playwright/test";

// ─── Constants ──────────────────────────────────────────────────────────────

export const ADMIN_EMAIL = "admin@dpf.local";
export const ADMIN_PASSWORD = process.env.DPF_ADMIN_PASSWORD || "changeme123";

// ─── Login ──────────────────────────────────────────────────────────────────

export async function loginToDPF(page: Page): Promise<void> {
  await page.goto("/login");
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  if (!page.url().includes("/login")) {
    console.log("[auth] Already logged in");
    return;
  }
  await page.waitForSelector('input[name="email"]', { timeout: 15_000 });
  await page.fill('input[name="email"]', ADMIN_EMAIL);
  await page.fill('input[name="password"]', ADMIN_PASSWORD);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 20_000 }),
    page.click('button[type="submit"]'),
  ]);
  console.log("[auth] Login successful");
}

// ─── Coworker Idle Detection ────────────────────────────────────────────────

/**
 * Waits until the coworker is idle (textarea exists and is enabled).
 *
 * The textarea is disabled while the coworker is processing a message.
 * This is the single source of truth for "coworker is ready for input".
 */
export async function waitForCoworkerIdle(
  page: Page,
  timeoutMs = 120_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // Check if textarea is enabled (coworker idle)
    const isIdle = await page.evaluate(() => {
      const ta = document.querySelector(
        '[data-agent-panel="true"] textarea',
      ) as HTMLTextAreaElement | null;
      return ta !== null && !ta.disabled;
    });
    if (isIdle) return;

    // While waiting, auto-approve any pending proposals that block the coworker
    const approveBtn = page.locator('[data-agent-panel="true"] button:has-text("Approve")').first();
    if (await approveBtn.isVisible({ timeout: 500 }).catch(() => false)) {
      console.log("[helper] Auto-approving proposal while waiting for idle...");
      await approveBtn.click();
      await page.waitForTimeout(1_000);
      continue;
    }

    await page.waitForTimeout(1_000);
  }
  throw new Error(`waitForCoworkerIdle timed out after ${timeoutMs}ms`);
}

/**
 * Waits until the coworker starts processing (textarea becomes disabled).
 * Used to confirm a message was actually sent.
 */
async function waitForCoworkerBusy(
  page: Page,
  timeoutMs = 10_000,
): Promise<boolean> {
  try {
    await page.waitForFunction(
      () => {
        const ta = document.querySelector(
          '[data-agent-panel="true"] textarea',
        ) as HTMLTextAreaElement | null;
        return ta?.disabled === true;
      },
      { timeout: timeoutMs },
    );
    return true;
  } catch {
    return false; // Message may not have triggered processing
  }
}

// ─── Send Message & Wait ────────────────────────────────────────────────────

/**
 * Sends a message to the coworker and waits for the complete response.
 *
 * Flow:
 * 1. Wait for coworker to be idle (textarea enabled)
 * 2. Fill the textarea and click Send
 * 3. Confirm the message was accepted (textarea becomes disabled)
 * 4. Wait for the response to complete (textarea becomes enabled again)
 * 5. Extract and return the last assistant message
 *
 * This handles the async nature of the coworker correctly — no race
 * conditions between sending and the coworker starting to process.
 */
export async function sendAndWait(
  page: Page,
  message: string,
  timeoutMs = 120_000,
): Promise<string> {
  const panel = page.locator('[data-agent-panel="true"]');

  // 1. Wait for coworker to be idle before attempting to send
  console.log(`[helper] Waiting for coworker idle before sending...`);
  await waitForCoworkerIdle(page, timeoutMs);

  // 2. Find textarea, fill, and send
  const input = panel.locator("textarea");
  await input.waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(500); // Brief stability pause

  await input.fill(message);

  // Click Send button (or press Enter as fallback)
  const sendBtn = panel.locator('button:has-text("Send")').first();
  const canClickSend =
    (await sendBtn.isVisible({ timeout: 2_000 }).catch(() => false)) &&
    (await sendBtn.isEnabled().catch(() => false));
  if (canClickSend) {
    await sendBtn.click();
  } else {
    await input.press("Enter");
  }

  // 3. Confirm the message was accepted (textarea goes disabled)
  const accepted = await waitForCoworkerBusy(page, 10_000);
  if (!accepted) {
    console.log("[helper] Warning: message may not have been sent (textarea never disabled)");
  }

  // 4. Wait for the response to complete (textarea becomes enabled)
  console.log(`[helper] Waiting for coworker response (up to ${timeoutMs / 1000}s)...`);
  await waitForCoworkerIdle(page, timeoutMs);

  // 5. Brief pause for DOM rendering
  await page.waitForTimeout(1_500);

  // 6. Extract and return the last assistant response
  const response = await extractLastResponse(page);
  console.log(`\n[demo] >>> ${message.slice(0, 80)}`);
  console.log(`[demo] <<< ${response.slice(0, 200)}`);
  return response;
}

// ─── Approve Proposals ──────────────────────────────────────────────────────

/**
 * Approves all visible proposal cards in the coworker panel, then waits
 * for the coworker to finish processing each approval.
 */
export async function approveAllProposals(
  page: Page,
  waitAfterMs = 120_000,
): Promise<number> {
  const panel = page.locator('[data-agent-panel="true"]');
  let approved = 0;
  const buttons = panel.locator('button:has-text("Approve")');
  const count = await buttons.count();

  for (let i = 0; i < count; i++) {
    const btn = buttons.nth(i);
    if (await btn.isVisible().catch(() => false)) {
      await btn.click();
      approved++;
      // Each approval may trigger coworker processing — wait for it to finish
      const wentBusy = await waitForCoworkerBusy(page, 5_000);
      if (wentBusy) {
        await waitForCoworkerIdle(page, waitAfterMs);
      }
      await page.waitForTimeout(1_000);
    }
  }

  if (approved > 0) console.log(`[demo] Approved ${approved} proposal(s)`);
  return approved;
}

// ─── Response Extraction ────────────────────────────────────────────────────

/**
 * Extracts the last assistant message text from the coworker panel.
 */
export async function extractLastResponse(page: Page): Promise<string> {
  return page.evaluate(() => {
    const panel = document.querySelector("[data-agent-panel='true']");
    if (!panel) return "[no panel]";

    // Assistant bubbles are left-aligned flex columns
    const allDivs = Array.from(panel.querySelectorAll("div")) as HTMLElement[];
    const assistantBubbles = allDivs.filter((el) => {
      const s = el.style;
      return (
        s.display === "flex" &&
        s.flexDirection === "column" &&
        s.marginBottom === "8px" &&
        s.alignItems === "flex-start"
      );
    });

    if (assistantBubbles.length > 0) {
      const last = assistantBubbles[assistantBubbles.length - 1];
      return last?.textContent?.trim() ?? "[empty]";
    }

    // Fallback: find any left-aligned div with substantial text
    const flexStart = allDivs.filter(
      (el) =>
        el.style.alignItems === "flex-start" &&
        (el.textContent?.length ?? 0) > 20,
    );
    const last = flexStart[flexStart.length - 1];
    return last?.textContent?.trim() ?? "[no assistant messages]";
  });
}

// ─── Phase Helpers ──────────────────────────────────────────────────────────

/**
 * Extracts the build ID from the page text (format: FB-XXXXXXXX).
 */
export async function extractBuildId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const text = document.body.innerText;
    const match = text.match(/FB-[A-F0-9]{8}/);
    return match?.[0] ?? null;
  });
}
