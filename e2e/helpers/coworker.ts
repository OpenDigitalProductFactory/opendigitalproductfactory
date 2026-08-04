import { Page } from "@playwright/test";

/**
 * Open the AI Coworker panel if it is not already visible.
 * FAB button: title "Open AI Coworker" (the live spelling — the hyphenated
 * "Open AI Co-worker" this helper used to pin exactly no longer exists, which
 * silently broke every caller whose session started with the panel COLLAPSED;
 * found by live-driving the portal, EP-UX-AUDITOR P2). Matched case-insensitively
 * on either spelling so a future copy edit cannot break it again.
 * Panel container: [data-agent-panel="true"]
 */
export async function openCoworker(page: Page): Promise<void> {
  const panel = page.locator('[data-agent-panel="true"]').first();
  if (await panel.isVisible({ timeout: 1_000 }).catch(() => false)) return;

  // Prefer the stable data hook; fall back to the accessible name.
  const fabHook = page.locator('button[data-agent-fab="true"]').first();
  const fab = (await fabHook.count()) > 0
    ? fabHook
    : page.getByRole("button", { name: /open ai co-?worker/i }).first();
  if (await fab.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await fab.click();
    await panel.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
  }
}

/**
 * Send a message to the AI Coworker and wait for a response.
 * Returns the response text, or a gap marker if the coworker is unavailable.
 *
 * NOTE: AI inference can take 30-60s. Tests calling this should set
 * test.setTimeout(90_000) or rely on the 60s global timeout in playwright.config.ts.
 */
export async function askCoworker(page: Page, prompt: string): Promise<string> {
  try {
    await openCoworker(page);

    // Textarea placeholder: "Ask your co-worker..." (idle) or "Sending..." (busy)
    const input = page.locator('textarea[placeholder*="co-worker" i]').first();
    if (!(await input.isVisible({ timeout: 6_000 }).catch(() => false))) {
      console.warn(`[coworker] Input not found for prompt: "${prompt.slice(0, 50)}"`);
      return "[coworker unavailable]";
    }

    await input.fill(prompt);

    // Submit is a small arrow button (aria-label="Send"); Enter is the fallback.
    const panel = page.locator('[data-agent-panel="true"]').first();
    const sendBtn = panel.locator('button[aria-label="Send"]').first();
    if (await sendBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await sendBtn.click();
    } else {
      await input.press("Enter");
    }

    // Wait for "Sending..." placeholder → coworker is processing
    await page
      .locator('textarea[placeholder="Sending..."]')
      .waitFor({ timeout: 5_000 })
      .catch(() => {});

    // Wait for textarea to become available again → response complete (up to 45s)
    await page
      .locator('textarea[placeholder*="co-worker" i]')
      .waitFor({ timeout: 45_000 })
      .catch(() => {});

    await page.waitForTimeout(500);

    // Extract last assistant message.
    // DOM: [data-agent-panel] > fragment children > scroll div > message bubbles
    // Each AgentMessageBubble root: div { display:flex; flexDirection:column; alignItems:flex-start|flex-end; marginBottom:8px }
    // Assistant messages have alignItems = "flex-start"
    const responseText = await page.evaluate(() => {
      const panel = document.querySelector("[data-agent-panel='true']");
      if (!panel) return "[no panel]";

      // Walk all divs inside panel and find message bubble containers
      // (display:flex, flexDirection:column, marginBottom:8px, alignItems:flex-start for assistant)
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

      if (assistantBubbles.length === 0) {
        // Fallback: look for any div with flex-start alignment that has substantial text
        const flexStart = allDivs.filter((el) => {
          const s = el.style;
          return s.alignItems === "flex-start" && (el.textContent?.length ?? 0) > 20;
        });
        const last = flexStart[flexStart.length - 1];
        return last ? (last.textContent?.trim() ?? "[empty]") : "[no assistant messages]";
      }

      const last = assistantBubbles[assistantBubbles.length - 1];
      return last.textContent?.trim() ?? "[empty]";
    });

    const trimmed = responseText.trim();
    console.log(
      `[coworker] Prompt: "${prompt.slice(0, 60)}..."\n[coworker] Response: "${trimmed.slice(0, 120)}..."`
    );
    return trimmed;
  } catch (err) {
    console.warn(`[coworker] Error during interaction: ${(err as Error).message}`);
    return "[coworker error]";
  }
}

/**
 * Wait until the coworker panel is idle — no busy status line, input re-enabled.
 *
 * `askCoworker`'s fixed 45s wait is not enough for a tool-using coworker: the
 * panel shows "<name> is still working (50s)" well past it, and a reader that
 * gives up early scrapes THAT placeholder as the reply. Observed live on four of
 * five shell routes (EP-UX-AUDITOR P2). Returns false on timeout so the caller
 * can report a NOT-RUN instead of judging a loading spinner.
 */
export async function waitForCoworkerIdle(
  page: Page,
  timeoutMs = 180_000,
): Promise<boolean> {
  return page
    .waitForFunction(
      () => {
        const panel = document.querySelector("[data-agent-panel='true']");
        if (!panel) return false;
        const busy =
          /\b(is thinking|is working on it|is still working|is using |Clearing conversation)/.test(
            panel.textContent ?? "",
          );
        if (busy) return false;
        const input = panel.querySelector("textarea");
        return !!input && !/sending/i.test(input.getAttribute("placeholder") ?? "");
      },
      undefined,
      { timeout: timeoutMs, polling: 500 },
    )
    .then(() => true)
    .catch(() => false);
}

/**
 * Observe the coworker's last turn as the button-decision lens needs it
 * (EP-UX-AUDITOR Phase 2): the human-visible reply text with the decision
 * buttons EXCLUDED, plus those buttons in DOM order with their recommended flag.
 *
 * `askCoworker` above returns the bubble's whole textContent, which folds the
 * button labels into the prose — fine for assertions on wording, useless for
 * judging whether buttons rendered. This returns the two apart so the lens can
 * ask "did a decision closeout produce clickable, recommended-first buttons?".
 */
export async function observeCoworkerDecision(page: Page): Promise<{
  panelPresent: boolean;
  reply: string;
  buttons: Array<{ label: string; recommended: boolean }>;
}> {
  return page.evaluate(() => {
    const panel = document.querySelector("[data-agent-panel='true']");
    if (!panel) return { panelPresent: false, reply: "", buttons: [] };

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

    const last = assistantBubbles[assistantBubbles.length - 1] ?? null;
    if (!last) return { panelPresent: true, reply: "", buttons: [] };

    const buttons = Array.from(
      last.querySelectorAll("[data-testid='agent-decision-option']"),
    ).map((el) => ({
      label: (el.textContent ?? "").trim(),
      recommended: el.getAttribute("data-recommended") === "true",
    }));

    // Reply = the bubble text with the decision block removed, so the lens reads
    // exactly the prose the coworker closed on.
    const clone = last.cloneNode(true) as HTMLElement;
    clone.querySelector("[data-testid='agent-decision']")?.remove();
    const reply = (clone.textContent ?? "").trim();

    return { panelPresent: true, reply, buttons };
  });
}

/**
 * Clear the AI Coworker conversation (Erase + confirm).
 */
export async function clearCoworker(page: Page): Promise<void> {
  try {
    await openCoworker(page);
    // Erase now lives inside the header overflow ("More options") menu.
    const moreBtn = page.locator('button[aria-label="More options"]').first();
    if (!(await moreBtn.isVisible({ timeout: 2_000 }).catch(() => false))) return;
    await moreBtn.click();
    await page.waitForTimeout(200);
    const eraseBtn = page
      .locator('button[title="Erase current conversation"]')
      .first();
    if (!(await eraseBtn.isVisible({ timeout: 2_000 }).catch(() => false))) return;
    await eraseBtn.click();
    await page.waitForTimeout(300);
    const confirmBtn = page.locator('button:has-text("Erase now")').first();
    if (await confirmBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await confirmBtn.click();
      await page.waitForTimeout(500);
    }
  } catch {
    // Non-blocking
  }
}
