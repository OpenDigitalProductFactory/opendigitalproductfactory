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

// ─── Message Counting ──────────────────────────────────────────────────────

/**
 * Counts assistant messages currently in the panel.
 * Used to detect when a NEW response arrives after sending.
 */
async function countAssistantMessages(page: Page): Promise<number> {
  return page.evaluate(() => {
    const panel = document.querySelector("[data-agent-panel='true']");
    if (!panel) return 0;
    return panel.querySelectorAll(
      '[data-testid="agent-message"][data-message-role="assistant"]',
    ).length;
  });
}

/**
 * Extracts assistant message at a specific index (0-based).
 * Returns the text content of that message.
 */
async function extractAssistantMessageAt(page: Page, index: number): Promise<string> {
  return page.evaluate((idx) => {
    const panel = document.querySelector("[data-agent-panel='true']");
    if (!panel) return "[no panel]";
    const messages = panel.querySelectorAll(
      '[data-testid="agent-message"][data-message-role="assistant"]',
    );
    if (idx >= messages.length) return "[no message at index]";
    const el = messages[idx] as HTMLElement;
    const content = el.querySelector('[data-testid="agent-message-content"]') as HTMLElement | null;
    return (content ?? el)?.textContent?.trim() ?? "[empty]";
  }, index);
}

// ─── Send Message & Wait ────────────────────────────────────────────────────

/**
 * Sends a message to the coworker and waits for the specific response.
 *
 * Flow:
 * 1. Count existing assistant messages (baseline)
 * 2. Wait for coworker to be idle
 * 3. Fill the textarea and click Send
 * 4. Confirm the message was accepted (textarea becomes disabled)
 * 5. Wait for the response to complete (textarea becomes enabled again)
 * 6. Verify a NEW assistant message appeared (count increased)
 * 7. Read that specific new message — not "the last one in the panel"
 *
 * This correlates each sent message with its response.
 */
export async function sendAndWait(
  page: Page,
  message: string,
  timeoutMs = 120_000,
): Promise<string> {
  const panel = page.locator('[data-agent-panel="true"]');

  // 1. Count assistant messages BEFORE sending — this is our baseline
  const countBefore = await countAssistantMessages(page);

  // 2. Wait for coworker to be idle before attempting to send
  await waitForCoworkerIdle(page, timeoutMs);

  // 3. Find textarea, fill, and send
  const input = panel.locator("textarea");
  await input.waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForTimeout(500);

  await input.fill(message);

  const sendBtn = panel.locator('button:has-text("Send")').first();
  const canClickSend =
    (await sendBtn.isVisible({ timeout: 2_000 }).catch(() => false)) &&
    (await sendBtn.isEnabled().catch(() => false));
  if (canClickSend) {
    await sendBtn.click();
  } else {
    await input.press("Enter");
  }

  // 4. Confirm the message was accepted (textarea goes disabled)
  const accepted = await waitForCoworkerBusy(page, 10_000);
  if (!accepted) {
    console.log("[helper] Warning: message may not have been sent (textarea never disabled)");
  }

  // 5. Wait for the response to complete (textarea becomes enabled)
  await waitForCoworkerIdle(page, timeoutMs);
  await page.waitForTimeout(1_500);

  // 5b. Handle "Not sent" — auto-retry if the client-side timeout fired
  for (let retryAttempt = 0; retryAttempt < 3; retryAttempt++) {
    const retryBtn = panel.locator('button:has-text("Retry")').first();
    const hasRetry = await retryBtn.isVisible({ timeout: 1_000 }).catch(() => false);
    if (!hasRetry) break;

    console.log(`[helper] Message shows "Not sent" — clicking Retry (attempt ${retryAttempt + 1})`);
    await retryBtn.click();

    const retryAccepted = await waitForCoworkerBusy(page, 10_000);
    if (retryAccepted) {
      await waitForCoworkerIdle(page, timeoutMs);
      await page.waitForTimeout(1_500);
    } else {
      console.log("[helper] Retry did not trigger processing");
      break;
    }
  }

  // 6. Read the NEW assistant message(s) that appeared after our send
  const countAfter = await countAssistantMessages(page);
  let response: string;

  if (countAfter > countBefore) {
    // Read all new messages (there may be multiple — e.g. system + assistant)
    // and concatenate them. The last new one is typically the main response.
    const newMessages: string[] = [];
    for (let i = countBefore; i < countAfter; i++) {
      const msg = await extractAssistantMessageAt(page, i);
      if (msg && msg !== "[empty]" && msg !== "[no message at index]") {
        newMessages.push(msg);
      }
    }
    response = newMessages.length > 0
      ? newMessages[newMessages.length - 1]!
      : "[new message was empty]";

    if (newMessages.length > 1) {
      console.log(`[helper] ${newMessages.length} new assistant messages; reading last one`);
    }
  } else {
    // No new messages — the coworker went idle without responding.
    // Fall back to reading the last message (may be from a previous turn).
    response = await extractLastResponse(page);
    console.log("[helper] Warning: no new assistant message detected after send");
  }

  console.log(`\n[send] >>> ${message.slice(0, 80)}`);
  console.log(`[recv] <<< ${response.slice(0, 200)}`);
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
 *
 * Uses data-testid="agent-message" and data-message-role="assistant" attributes
 * on AgentMessageBubble components for reliable selection.
 */
export async function extractLastResponse(page: Page): Promise<string> {
  return page.evaluate(() => {
    const panel = document.querySelector("[data-agent-panel='true']");
    if (!panel) return "[no panel]";

    // Use data-testid attributes for reliable selection
    const assistantMessages = Array.from(
      panel.querySelectorAll('[data-testid="agent-message"][data-message-role="assistant"]'),
    ) as HTMLElement[];

    if (assistantMessages.length > 0) {
      const last = assistantMessages[assistantMessages.length - 1];
      // Prefer the content sub-element if present
      const content = last.querySelector('[data-testid="agent-message-content"]') as HTMLElement | null;
      return (content ?? last)?.textContent?.trim() ?? "[empty]";
    }

    // Fallback: any element with the data attribute (handles older DOM states)
    const allMessages = Array.from(
      panel.querySelectorAll('[data-testid="agent-message"]'),
    ) as HTMLElement[];
    const assistantFallback = allMessages.filter(
      (el) => el.getAttribute("data-message-role") !== "user",
    );
    if (assistantFallback.length > 0) {
      const last = assistantFallback[assistantFallback.length - 1];
      return last?.textContent?.trim() ?? "[empty]";
    }

    return "[no assistant messages]";
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
