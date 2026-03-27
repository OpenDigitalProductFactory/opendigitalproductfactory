/**
 * Suite 6: Exploratory — Varied, Human-Like & Imperfect Inputs
 *
 * Tests the portal with realistic user behaviour: typos, vague questions,
 * single words, incomplete sentences, wrong terminology, and edge-case
 * form submissions. Observations feed the improvement proposal log.
 *
 * Scoring criteria recorded in console for each AI Coworker response:
 *   relevance  0-3  (0=off-topic, 1=partial, 2=relevant, 3=excellent)
 *   helpful    0-3  (0=useless, 1=generic, 2=actionable, 3=specific+actionable)
 *   length     0-2  (0=too short/long, 1=ok, 2=just right)
 *   format     0-2  (0=wall of text, 1=structured, 2=well-formatted with examples)
 *   score      /10  composite
 *
 * Each observation is logged with a GAP/OPT prefix for the improvement log.
 */
import { test, expect } from "@playwright/test";
import { ensureLoggedIn } from "./helpers/auth";
import { clearCoworker, openCoworker } from "./helpers/coworker";

// ─── Scoring helper ────────────────────────────────────────────────────────────

type ResponseScore = {
  prompt: string;
  response: string;
  relevance: 0 | 1 | 2 | 3;
  helpful: 0 | 1 | 2 | 3;
  length: 0 | 1 | 2;
  format: 0 | 1 | 2;
};

function scoreResponse(s: ResponseScore): void {
  const total = s.relevance + s.helpful + s.length + s.format;
  const max = 10;
  const score = Math.round((total / (3 + 3 + 2 + 2)) * max);
  console.log(`\n[score] prompt: "${s.prompt.slice(0, 60)}"`);
  console.log(`[score] response: "${s.response.slice(0, 120)}"`);
  console.log(`[score] relevance=${s.relevance}/3  helpful=${s.helpful}/3  length=${s.length}/2  format=${s.format}/2  TOTAL=${score}/10`);
}

/**
 * Send a message and wait for response — accepts already-opened coworker panel.
 * Textarea: placeholder "Ask your co-worker..." / "Sending..."
 * Response extraction: DOM traversal matching AgentMessageBubble's inline styles.
 */
async function sendAndCapture(page: import("@playwright/test").Page, prompt: string): Promise<string> {
  const input = page.locator('textarea[placeholder*="co-worker" i]').first();

  if (!(await input.isVisible({ timeout: 5_000 }).catch(() => false))) {
    return "[coworker unavailable]";
  }

  await input.fill(prompt);

  // Try the panel's Send button first; fall back to Enter key
  const panel = page.locator('[data-agent-panel="true"]').first();
  const sendBtn = panel.locator('button:has-text("Send")').first();
  if (await sendBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await sendBtn.click();
  } else {
    await input.press("Enter");
  }

  // Wait for "Sending..." → then for textarea to reappear (response complete)
  await page.locator('textarea[placeholder="Sending..."]').waitFor({ timeout: 5_000 }).catch(() => {});
  await page.locator('textarea[placeholder*="co-worker" i]').waitFor({ timeout: 45_000 }).catch(() => {});
  await page.waitForTimeout(400);

  // Extract last assistant message via DOM traversal (same logic as coworker.ts helper)
  return await page.evaluate(() => {
    const panelEl = document.querySelector("[data-agent-panel='true']");
    if (!panelEl) return "[no panel]";

    const allDivs = Array.from(panelEl.querySelectorAll("div")) as HTMLElement[];
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
      // Fallback: any flex-start div with substantial text
      const flexStart = allDivs.filter((el) => {
        const s = el.style;
        return s.alignItems === "flex-start" && (el.textContent?.length ?? 0) > 20;
      });
      const last = flexStart[flexStart.length - 1];
      return last ? (last.textContent?.trim() ?? "[empty]") : "[no assistant messages]";
    }

    const last = assistantBubbles[assistantBubbles.length - 1];
    return last.textContent?.trim() ?? "[empty]";
  }).catch(() => "[evaluate error]");
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe("Suite 6: Exploratory — varied inputs", () => {

  // ── Block A: Vague / single-word queries ──────────────────────────────────

  test("6.A1 Single word: 'saas'", async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto("/workspace");
    await page.waitForLoadState("networkidle");
    await clearCoworker(page);
    await openCoworker(page);
    const r = await sendAndCapture(page, "saas");
    expect.soft(r.length).toBeGreaterThan(10);
    scoreResponse({ prompt: "saas", response: r,
      relevance: r.toLowerCase().match(/saas|subscri|software|service/) ? 2 : 1,
      helpful: r.length > 100 ? 2 : 1,
      length: r.length > 50 && r.length < 1500 ? 2 : 1,
      format: r.includes("\n") ? 1 : 0,
    });
    await page.screenshot({ path: "e2e-results/06-A1-saas.png" });
  });

  test("6.A2 Single word: 'roles'", async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto("/workspace");
    await page.waitForLoadState("networkidle");
    await openCoworker(page);
    const r = await sendAndCapture(page, "roles");
    expect.soft(r.length).toBeGreaterThan(10);
    scoreResponse({ prompt: "roles", response: r,
      relevance: r.toLowerCase().match(/role|platform|assign|business|model/) ? 2 : 1,
      helpful: r.length > 100 ? 2 : 1,
      length: r.length > 50 && r.length < 1500 ? 2 : 1,
      format: r.includes("\n") ? 1 : 0,
    });
    await page.screenshot({ path: "e2e-results/06-A2-roles.png" });
  });

  test("6.A3 Vague question: 'what can you do'", async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto("/workspace");
    await page.waitForLoadState("networkidle");
    await clearCoworker(page);
    await openCoworker(page);
    const r = await sendAndCapture(page, "what can you do");
    scoreResponse({ prompt: "what can you do", response: r,
      relevance: r.toLowerCase().match(/product|portfolio|epic|backlog|role|digital|help/) ? 2 : 1,
      helpful: r.length > 150 ? 2 : 1,
      length: r.length > 100 && r.length < 2000 ? 2 : 1,
      format: r.includes("\n") || r.includes("•") ? 2 : 1,
    });
    await page.screenshot({ path: "e2e-results/06-A3-what-can-you-do.png" });
  });

  // ── Block B: Typos and informal phrasing ─────────────────────────────────

  test("6.B1 Typo-heavy: 'wat buisness modl shoud i use fr a car warsh'", async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto("/workspace");
    await page.waitForLoadState("networkidle");
    await clearCoworker(page);
    await openCoworker(page);
    const prompt = "wat buisness modl shoud i use fr a car warsh";
    const r = await sendAndCapture(page, prompt);
    console.log(`[OPT-001] Typo handling: did agent understand? response: "${r.slice(0, 200)}"`);
    expect.soft(r.length).toBeGreaterThan(10);
    scoreResponse({ prompt, response: r,
      relevance: r.toLowerCase().match(/service|professional|car|wash|clean|maintenance|customer/) ? 3 : r.length > 30 ? 1 : 0,
      helpful: r.length > 100 ? 2 : 1,
      length: r.length > 50 && r.length < 1500 ? 2 : 1,
      format: r.includes("\n") ? 1 : 0,
    });
    await page.screenshot({ path: "e2e-results/06-B1-typos.png" });
  });

  test("6.B2 Casual phrasing: 'help me set up my pool company stuff'", async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto("/workspace");
    await page.waitForLoadState("networkidle");
    await clearCoworker(page);
    await openCoworker(page);
    const prompt = "help me set up my pool company stuff";
    const r = await sendAndCapture(page, prompt);
    console.log(`[OPT-002] Casual input handling: "${r.slice(0, 200)}"`);
    scoreResponse({ prompt, response: r,
      relevance: r.toLowerCase().match(/pool|service|product|portfolio|business|model|role/) ? 3 : 1,
      helpful: r.toLowerCase().match(/create|add|navigate|portfolio|product/) ? 3 : 1,
      length: r.length > 50 && r.length < 1500 ? 2 : 1,
      format: r.includes("\n") ? 2 : 1,
    });
    await page.screenshot({ path: "e2e-results/06-B2-casual.png" });
  });

  test("6.B3 Mid-sentence cut-off: 'what roles does a nonprofit need when they'", async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto("/workspace");
    await page.waitForLoadState("networkidle");
    await clearCoworker(page);
    await openCoworker(page);
    const prompt = "what roles does a nonprofit need when they";
    const r = await sendAndCapture(page, prompt);
    console.log(`[OPT-003] Incomplete sentence: "${r.slice(0, 200)}"`);
    // Good agent: asks for clarification OR answers most likely interpretation
    const askedClarification = r.toLowerCase().match(/could you|what kind|can you clarify|more details|what type|which/);
    const answeredAnyway = r.toLowerCase().match(/nonprofit|role|volunteer|fund|mission|community|organization/);
    console.log(`[OPT-003] Asked clarification: ${!!askedClarification}, answered anyway: ${!!answeredAnyway}`);
    scoreResponse({ prompt, response: r,
      relevance: (askedClarification || answeredAnyway) ? 2 : 1,
      helpful: askedClarification ? 3 : answeredAnyway ? 2 : 0,
      length: r.length > 20 && r.length < 1200 ? 2 : 1,
      format: 1,
    });
    await page.screenshot({ path: "e2e-results/06-B3-incomplete.png" });
  });

  // ── Block C: Wrong terminology ────────────────────────────────────────────

  test("6.C1 Wrong term: 'add a department to my product'", async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto("/workspace");
    await page.waitForLoadState("networkidle");
    await clearCoworker(page);
    await openCoworker(page);
    // User means "role" but says "department"
    const prompt = "add a department to my product";
    const r = await sendAndCapture(page, prompt);
    console.log(`[OPT-004] Wrong terminology (department=role?): "${r.slice(0, 200)}"`);
    const corrected = r.toLowerCase().match(/role|business model|assignment|team|member|portfolio/);
    const confused = r.toLowerCase().match(/department|hr|employee|workforce/);
    console.log(`[OPT-004] Redirected to roles: ${!!corrected}, went to HR dept: ${!!confused}`);
    scoreResponse({ prompt, response: r,
      relevance: corrected ? 3 : confused ? 1 : 1,
      helpful: corrected ? 3 : 1,
      length: r.length > 50 ? 2 : 1,
      format: 1,
    });
    await page.screenshot({ path: "e2e-results/06-C1-wrong-term-dept.png" });
  });

  test("6.C2 Wrong term: 'create a new app in the system'", async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto("/workspace");
    await page.waitForLoadState("networkidle");
    await clearCoworker(page);
    await openCoworker(page);
    // User means "digital product" but says "app"
    const prompt = "create a new app in the system";
    const r = await sendAndCapture(page, prompt);
    console.log(`[OPT-005] Wrong term (app=digital product?): "${r.slice(0, 200)}"`);
    const mappedToProduct = r.toLowerCase().match(/digital product|portfolio|create|inventory/);
    scoreResponse({ prompt, response: r,
      relevance: mappedToProduct ? 3 : 1,
      helpful: mappedToProduct ? 3 : 1,
      length: r.length > 50 ? 2 : 1,
      format: 1,
    });
    await page.screenshot({ path: "e2e-results/06-C2-wrong-term-app.png" });
  });

  test("6.C3 Platform jargon confusion: 'how do i set the hitl tier'", async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto("/workspace");
    await page.waitForLoadState("networkidle");
    await clearCoworker(page);
    await openCoworker(page);
    const prompt = "how do i set the hitl tier for my business model roles";
    const r = await sendAndCapture(page, prompt);
    console.log(`[OPT-006] HITL tier query: "${r.slice(0, 200)}"`);
    const explainedHitl = r.toLowerCase().match(/hitl|human.in.the.loop|tier|approve|review|autonomous/);
    const gaveSteps = r.toLowerCase().match(/admin|business model|role|assign|navigate/);
    scoreResponse({ prompt, response: r,
      relevance: explainedHitl ? 3 : 1,
      helpful: (explainedHitl && gaveSteps) ? 3 : gaveSteps ? 2 : 1,
      length: r.length > 80 ? 2 : 1,
      format: r.includes("\n") ? 2 : 1,
    });
    await page.screenshot({ path: "e2e-results/06-C3-hitl-tier.png" });
  });

  // ── Block D: Multi-turn and context ──────────────────────────────────────

  test("6.D1 Follow-up without context: first ask then vague follow-up", async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto("/workspace");
    await page.waitForLoadState("networkidle");
    await clearCoworker(page);
    await openCoworker(page);

    // First message
    const r1 = await sendAndCapture(page, "we run an animal shelter in Taylor TX");
    console.log(`[D1] Turn 1: "${r1.slice(0, 150)}"`);

    // Vague follow-up — relies on context from turn 1
    const r2 = await sendAndCapture(page, "what roles do we need");
    console.log(`[D1] Turn 2 (context-dependent): "${r2.slice(0, 150)}"`);

    const usedContext = r2.toLowerCase().match(/animal|shelter|rescue|foster|adopt|volunteer|rescue|community|taylor/);
    console.log(`[OPT-007] Multi-turn context retained: ${!!usedContext}`);
    scoreResponse({ prompt: "what roles do we need (after shelter context)", response: r2,
      relevance: usedContext ? 3 : 1,
      helpful: r2.length > 100 ? 2 : 1,
      length: r2.length > 50 && r2.length < 1500 ? 2 : 1,
      format: r2.includes("\n") ? 2 : 1,
    });
    await page.screenshot({ path: "e2e-results/06-D1-multi-turn.png" });
  });

  test("6.D2 Context switch mid-conversation", async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto("/workspace");
    await page.waitForLoadState("networkidle");
    await clearCoworker(page);
    await openCoworker(page);

    // Establish HOA context
    await sendAndCapture(page, "I manage Brushy Creek HOA");
    // Abrupt switch to pool company
    const r = await sendAndCapture(page, "actually forget that. im doing pools now. same question");
    console.log(`[OPT-008] Context switch: "${r.slice(0, 200)}"`);
    const handledSwitch = r.toLowerCase().match(/pool|service|clean|mainten|water|chemical/);
    console.log(`[OPT-008] Handled context switch to pool: ${!!handledSwitch}`);
    scoreResponse({ prompt: "context switch HOA→pool", response: r,
      relevance: handledSwitch ? 3 : 1,
      helpful: r.length > 100 ? 2 : 1,
      length: r.length > 50 ? 2 : 1,
      format: 1,
    });
    await page.screenshot({ path: "e2e-results/06-D2-context-switch.png" });
  });

  // ── Block E: Business model edge cases ──────────────────────────────────

  test("6.E1 Ask about unlisted industry: 'business model for a food truck'", async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto("/workspace");
    await page.waitForLoadState("networkidle");
    await clearCoworker(page);
    await openCoworker(page);
    const prompt = "what business model template should i use for a food truck";
    const r = await sendAndCapture(page, prompt);
    console.log(`[OPT-009] Unlisted industry (food truck): "${r.slice(0, 200)}"`);
    const suggestedCustom = r.toLowerCase().match(/custom|create|none|doesn|doesn't|exact|closest|fit/);
    const suggestedServices = r.toLowerCase().match(/professional service|service|ecommerce|retail/);
    console.log(`[OPT-009] Suggested custom model: ${!!suggestedCustom}, suggested built-in: ${!!suggestedServices}`);
    scoreResponse({ prompt, response: r,
      relevance: (suggestedCustom || suggestedServices) ? 3 : 1,
      helpful: suggestedCustom ? 3 : suggestedServices ? 2 : 1,
      length: r.length > 100 ? 2 : 1,
      format: r.includes("\n") ? 2 : 1,
    });
    await page.screenshot({ path: "e2e-results/06-E1-food-truck.png" });
  });

  test("6.E2 Contradictory request: 'assign all business models to one product'", async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto("/workspace");
    await page.waitForLoadState("networkidle");
    await clearCoworker(page);
    await openCoworker(page);
    const prompt = "how do i assign all 8 business models to a single product at once";
    const r = await sendAndCapture(page, prompt);
    console.log(`[OPT-010] Mass-assign request: "${r.slice(0, 200)}"`);
    const explainedLimits = r.toLowerCase().match(/one.at.a.time|individually|separate|each|one by one|multiple/);
    const warnedSemantic = r.toLowerCase().match(/recommend|typically|usually|best practice|suggest|single/);
    console.log(`[OPT-010] Explained process: ${!!explainedLimits}, gave recommendation: ${!!warnedSemantic}`);
    scoreResponse({ prompt, response: r,
      relevance: 3,
      helpful: (explainedLimits || warnedSemantic) ? 3 : 1,
      length: r.length > 80 ? 2 : 1,
      format: 1,
    });
    await page.screenshot({ path: "e2e-results/06-E2-mass-assign.png" });
  });

  test("6.E3 Nonsense input: random characters", async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto("/workspace");
    await page.waitForLoadState("networkidle");
    await clearCoworker(page);
    await openCoworker(page);
    const prompt = "asdkjh qwerty 12345 !!@@##";
    const r = await sendAndCapture(page, prompt);
    console.log(`[OPT-011] Nonsense input handling: "${r.slice(0, 200)}"`);
    const askedClarification = r.toLowerCase().match(/could you|what do you|unclear|not sure|clarify|rephrase|understand/);
    const failedGracefully = r.length > 5; // At least some response
    console.log(`[OPT-011] Asked clarification: ${!!askedClarification}, graceful: ${failedGracefully}`);
    scoreResponse({ prompt, response: r,
      relevance: askedClarification ? 3 : 1,
      helpful: askedClarification ? 3 : 1,
      length: r.length > 10 && r.length < 500 ? 2 : 1,
      format: 1,
    });
    await page.screenshot({ path: "e2e-results/06-E3-nonsense.png" });
  });

  // ── Block F: UI stress tests ──────────────────────────────────────────────

  test("6.F1 Navigate to non-existent product detail", async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto("/portfolio/product/nonexistent-id-12345");
    await page.waitForLoadState("networkidle");
    const is404 = page.url().includes("404") || page.url().includes("not-found");
    // Next.js App Router notFound() renders at same URL with default text "This page could not be found."
    const hasNotFound = await page
      .locator("text=not found")
      .or(page.locator("text=404"))
      .or(page.locator("text=could not be found"))
      .first()
      .isVisible({ timeout: 3_000 })
      .catch(() => false);
    console.log(`[OPT-012] 404 for nonexistent product: url=${page.url()}, notFoundText=${hasNotFound}`);
    expect.soft(is404 || hasNotFound).toBe(true);
    await page.screenshot({ path: "e2e-results/06-F1-404-product.png" });
  });

  test("6.F2 Admin business models page loads quickly", async ({ page }) => {
    await ensureLoggedIn(page);
    const start = Date.now();
    await page.goto("/admin/business-models");
    await page.waitForLoadState("networkidle");
    const elapsed = Date.now() - start;
    console.log(`[OPT-013] Admin BM page load time: ${elapsed}ms`);
    if (elapsed > 3000) {
      console.log(`[OPT-013] SLOW: page took ${elapsed}ms — consider caching or pagination`);
    }
    expect.soft(elapsed).toBeLessThan(8000);
    await page.screenshot({ path: "e2e-results/06-F2-admin-load-time.png" });
  });

  test("6.F3 Ops backlog page handles no search results gracefully", async ({ page }) => {
    await ensureLoggedIn(page);
    await page.goto("/ops");
    await page.waitForLoadState("networkidle");
    // Look for any search/filter input and enter nonsense
    const searchInput = page.locator('input[type="search"], input[placeholder*="search" i], input[placeholder*="filter" i]').first();
    if (await searchInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await searchInput.fill("XYZNOTFOUND99999");
      await page.waitForTimeout(500);
      const emptyState = await page.locator("text=no results, text=nothing found, text=no items, text=empty").first()
        .isVisible({ timeout: 3_000 }).catch(() => false);
      console.log(`[OPT-014] Empty search state shown: ${emptyState}`);
    } else {
      console.log(`[OPT-014] No search input on /ops — search not implemented`);
    }
    await page.screenshot({ path: "e2e-results/06-F3-empty-search.png" });
  });
});
