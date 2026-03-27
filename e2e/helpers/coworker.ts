import { Page } from "@playwright/test";

/**
 * Open the AI Coworker panel if it is not already visible.
 * FAB button: title="Open AI Co-worker" / text "AI Coworker"
 * Panel container: [data-agent-panel="true"]
 */
export async function openCoworker(page: Page): Promise<void> {
  const panel = page.locator('[data-agent-panel="true"]').first();
  if (await panel.isVisible({ timeout: 1_000 }).catch(() => false)) return;

  const fab = page.locator('button[title="Open AI Co-worker"]').first();
  if (await fab.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await fab.click();
    await page.waitForTimeout(800);
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

    // Send button: type="button" text "Send" inside the panel
    const panel = page.locator('[data-agent-panel="true"]').first();
    const sendBtn = panel.locator('button:has-text("Send")').first();
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
 * Clear the AI Coworker conversation (Erase + confirm).
 */
export async function clearCoworker(page: Page): Promise<void> {
  try {
    await openCoworker(page);
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
