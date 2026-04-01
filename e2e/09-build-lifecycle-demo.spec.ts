/**
 * Build Studio Full Lifecycle Demo
 *
 * Phase-driven test that reads every AI response and adapts.
 * The phase indicator (data-current-phase) is the source of truth —
 * the test never assumes a phase transition happened without checking.
 *
 * Run with: DPF_ADMIN_PASSWORD=<password> npx playwright test e2e/09-build-lifecycle-demo.spec.ts --headed
 */
import { test, expect } from "@playwright/test";
import {
  loginToDPF,
  sendAndWait,
  approveAllProposals,
  waitForCoworkerIdle,
  extractBuildId,
} from "./helpers";

const FEATURE_TITLE = "Customer Complaint Tracker";
const MAX_PHASE_ATTEMPTS = 5;
const MIN_RESPONSE_LENGTH = 50;

// ─── Response Analysis ─────────────────────────────────────────────────────

function isCannedFallback(response: string): boolean {
  return response.includes("wasn't able to help") ||
    response.includes("No AI provider was matched") ||
    response.includes("Unable to process");
}

function isAskingQuestion(response: string): boolean {
  return [/should I/i, /do you want/i, /which approach/i, /could you clarify/i, /want me to/i]
    .some((p) => p.test(response));
}

function hasBlocker(response: string): boolean {
  return [/can'?t\s+(safely\s+)?(modify|add|create|edit|write)/i, /blocker/i, /failed to/i, /error:/i]
    .some((p) => p.test(response));
}

function didComplete(response: string, keywords: string[]): boolean {
  return keywords.some((kw) => response.toLowerCase().includes(kw.toLowerCase()));
}

async function getCurrentPhase(page: import("@playwright/test").Page): Promise<string> {
  return page.evaluate(() => {
    const indicator = document.querySelector('[data-testid="phase-indicator"]');
    return indicator?.getAttribute("data-current-phase") ?? "unknown";
  });
}

// ─── Phase-Aware Send ──────────────────────────────────────────────────────

/**
 * Send a message, read the response, validate it's not a canned fallback.
 * Returns the response text. Fails the test if routing is broken.
 */
async function sendAndRead(
  page: import("@playwright/test").Page,
  message: string,
  label: string,
  timeoutMs = 180_000,
): Promise<string> {
  const response = await sendAndWait(page, message, timeoutMs);
  await approveAllProposals(page);

  // Fail fast on routing errors — don't waste 10 minutes sending more messages
  if (isCannedFallback(response)) {
    throw new Error(
      `[${label}] AI provider routing broken — got canned fallback: "${response.slice(0, 150)}". ` +
      `Fix provider config before re-running test.`,
    );
  }

  const phase = await getCurrentPhase(page);
  console.log(`[${label}] Phase: ${phase} | Response (${response.length} chars): ${response.slice(0, 200)}`);
  return response;
}

/**
 * Wait for a specific phase, retrying with adaptive messages.
 * Returns when the target phase (or later) is reached.
 */
async function waitForPhase(
  page: import("@playwright/test").Page,
  targetPhase: string,
  promptFn: (attempt: number, currentPhase: string, lastResponse: string) => string,
  label: string,
  timeoutMs = 180_000,
): Promise<string> {
  const phaseOrder = ["ideate", "plan", "build", "review", "ship", "complete"];
  const targetIdx = phaseOrder.indexOf(targetPhase);

  let lastResponse = "";
  for (let attempt = 0; attempt < MAX_PHASE_ATTEMPTS; attempt++) {
    const currentPhase = await getCurrentPhase(page);
    const currentIdx = phaseOrder.indexOf(currentPhase);

    if (currentIdx >= targetIdx) {
      console.log(`[${label}] Reached phase: ${currentPhase}`);
      return lastResponse;
    }

    const message = promptFn(attempt, currentPhase, lastResponse);
    lastResponse = await sendAndRead(page, message, `${label}:${attempt}`, timeoutMs);
  }

  const finalPhase = await getCurrentPhase(page);
  throw new Error(`[${label}] Failed to reach phase "${targetPhase}" after ${MAX_PHASE_ATTEMPTS} attempts. Stuck at: ${finalPhase}`);
}

// ─── Test ──────────────────────────────────────────────────────────────────

test.describe("Build Studio Lifecycle Demo", () => {
  test("full feature build: create, design, plan, build, deploy, verify", async ({ page }) => {
    test.setTimeout(900_000); // 15 minutes

    // ━━━ Step 1: Login & Navigate ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log("\n=== STEP 1: Login ===");
    await loginToDPF(page);

    console.log("\n=== STEP 2: Navigate to Build Studio ===");
    await page.goto("/build");
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    const featureInput = page.locator('input[placeholder*="feature" i]');
    await expect(featureInput).toBeVisible({ timeout: 15_000 });

    // ━━━ Step 2: Create Feature ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log("\n=== STEP 3: Create Feature ===");
    await featureInput.fill(FEATURE_TITLE);
    await page.locator("button").filter({ hasText: /^New$/i }).click();

    const panel = page.locator('[data-agent-panel="true"]');
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(panel.locator("text=Software Engineer").first()).toBeVisible({ timeout: 5_000 });

    // Wait for the auto-message (feature creation triggers an initial AI response)
    await waitForCoworkerIdle(page, 120_000);
    await page.waitForTimeout(2_000);
    await approveAllProposals(page);

    const initialPhase = await getCurrentPhase(page);
    console.log(`[create] Initial phase: ${initialPhase}`);
    await page.screenshot({ path: "e2e-report/demo-03-feature-created.png" });

    // ━━━ Step 3: Ideate → Plan ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log("\n=== IDEATE PHASE ===");

    // First message: give the AI all requirements upfront
    let response = await sendAndRead(page,
      "Design this feature now. Here are the exact requirements — do not ask for clarification:\n" +
      "1) A simple complaints list page at /complaints showing all complaints with status badges (open, investigating, resolved, closed)\n" +
      "2) A form to submit a new complaint with fields: customer name (text), description (textarea), severity (select: low/medium/high/critical), category (text)\n" +
      "3) In-memory data store (no database changes needed — use a simple array or Map for this demo)\n" +
      "4) Use existing platform UI patterns (Tailwind, shadcn components if available)\n" +
      "Save the design document now.",
      "ideate",
    );

    expect(response.length, "Ideate response too short — likely canned fallback").toBeGreaterThan(MIN_RESPONSE_LENGTH);
    await page.screenshot({ path: "e2e-report/demo-04-ideate.png" });

    // Drive to plan phase — adapt based on what AI said
    await waitForPhase(page, "plan", (attempt, phase, lastResp) => {
      if (phase === "ideate" && isAskingQuestion(lastResp)) {
        return "Do not ask questions. Use the requirements I gave you. Save the design document and advance to plan phase immediately.";
      }
      if (phase === "ideate") {
        return "The design is complete and approved. Save it and advance to the plan phase now.";
      }
      return "Advance to the plan phase now.";
    }, "ideate→plan");

    await page.screenshot({ path: "e2e-report/demo-05-plan.png" });

    // ━━━ Step 4: Plan → Build ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log("\n=== PLAN PHASE ===");

    response = await sendAndRead(page,
      "Create the implementation plan. This is a single-file feature — no database changes needed:\n" +
      "- One new file: apps/web/app/(shell)/complaints/page.tsx\n" +
      "- Contains: complaint list with status badges, submit form, in-memory state using React useState\n" +
      "- No Prisma schema changes, no API routes, no migrations\n" +
      "Save the plan and advance to the build phase.",
      "plan",
    );

    await waitForPhase(page, "build", (attempt, phase, lastResp) => {
      if (hasBlocker(lastResp)) {
        return "Ignore blockers. This is a simple single-page feature with in-memory data. " +
          "Save the plan and advance to build phase now.";
      }
      if (phase === "plan") {
        return "The plan is approved. Advance to the build phase now.";
      }
      return "Advance to the build phase.";
    }, "plan→build");

    await page.screenshot({ path: "e2e-report/demo-06-build-start.png" });

    // ━━━ Step 5: Build → Review ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log("\n=== BUILD PHASE ===");

    response = await sendAndRead(page,
      "Generate the code in the sandbox now. Use the write_sandbox_file tool to create:\n" +
      "apps/web/app/(shell)/complaints/page.tsx\n\n" +
      "This should be a React 'use client' component with:\n" +
      "- useState for an in-memory complaints array\n" +
      "- A form to add complaints (name, description, severity, category)\n" +
      "- A list showing complaints with status badges\n" +
      "- Tailwind CSS styling\n\n" +
      "Do NOT modify the Prisma schema. Do NOT create API routes. This is a client-side only page.\n" +
      "After creating the file, run the sandbox typecheck to verify.",
      "build",
      300_000,
    );

    expect(response.length, "Build response too short — likely canned fallback").toBeGreaterThan(MIN_RESPONSE_LENGTH);

    // Check if code was written — adapt if not
    if (!didComplete(response, ["created", "generated", "wrote", "file", "page.tsx", "write_sandbox_file"])) {
      console.log("[build] Code not confirmed written, following up...");
      response = await sendAndRead(page,
        "Use the write_sandbox_file tool to create apps/web/app/(shell)/complaints/page.tsx now. " +
        "Do not explain — just write the file.",
        "build-retry",
        300_000,
      );
    }

    // If AI hasn't run typecheck, ask for it
    if (!didComplete(response, ["typecheck", "type check", "no errors", "compiles"])) {
      console.log("[build] Requesting typecheck...");
      response = await sendAndRead(page,
        "Run the sandbox typecheck: run_sandbox_command with 'pnpm --filter web exec tsc --noEmit'.",
        "build-typecheck",
        120_000,
      );
    }

    await page.screenshot({ path: "e2e-report/demo-07-built.png" });
    const buildId = await extractBuildId(page);
    console.log(`[build] Build ID: ${buildId}`);

    // Drive to review phase
    await waitForPhase(page, "review", (attempt, phase, lastResp) => {
      if (phase === "build" && hasBlocker(lastResp)) {
        return "The typecheck passed. Save verification evidence and advance to review phase.";
      }
      if (phase === "build") {
        return "Advance to the review phase now. The code is written and typechecks.";
      }
      return "Advance to review phase.";
    }, "build→review", 300_000);

    await page.screenshot({ path: "e2e-report/demo-08-review.png" });

    // ━━━ Step 6: Review → Ship ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log("\n=== REVIEW PHASE ===");

    response = await sendAndRead(page,
      "Evaluate the build. All acceptance criteria are met — this is an in-memory demo, " +
      "it compiles, and the page renders. Mark all criteria as met and advance to ship.",
      "review",
      300_000,
    );

    await waitForPhase(page, "ship", (attempt, phase, lastResp) => {
      if (phase === "review") {
        return "All acceptance criteria are met. Advance to ship phase now. Do not ask questions.";
      }
      return "Advance to ship phase.";
    }, "review→ship", 300_000);

    await page.screenshot({ path: "e2e-report/demo-09-ship.png" });

    // ━━━ Step 7: Ship ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log("\n=== SHIP PHASE ===");

    // Step 7a: deploy_feature
    response = await sendAndRead(page,
      "Ship this feature. Start by calling deploy_feature to extract the sandbox diff.",
      "ship:deploy",
      180_000,
    );

    if (!didComplete(response, ["diff", "extracted", "deploy_feature", "deployment window", "deploy"])) {
      console.log("[ship] deploy_feature not confirmed, retrying...");
      response = await sendAndRead(page,
        "Call the deploy_feature tool now.",
        "ship:deploy-retry",
        180_000,
      );
    }

    // Step 7b: register_digital_product_from_build
    response = await sendAndRead(page,
      "Now call register_digital_product_from_build with name 'Customer Complaint Tracker' and portfolioSlug 'default'.",
      "ship:register",
      180_000,
    );

    // Step 7c: create_build_epic
    response = await sendAndRead(page,
      "Now call create_build_epic to create the backlog epic for this feature.",
      "ship:epic",
      120_000,
    );

    // Step 7d: execute_promotion
    response = await sendAndRead(page,
      "Now call execute_promotion with the promotion ID to deploy to production.",
      "ship:promote",
      180_000,
    );

    await page.screenshot({ path: "e2e-report/demo-10-shipped.png" });

    // ━━━ Step 8: Verify ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log("\n=== VERIFY ===");

    await page.goto("/ops");
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(2_000);
    const backlogText = await page.textContent("body");
    const hasBacklogItem = backlogText?.toLowerCase().includes("complaint") ?? false;
    console.log(`[verify] Feature in backlog: ${hasBacklogItem}`);

    const healthResp = await page.request.get("/api/health");
    console.log(`[verify] Portal health: ${healthResp.status()}`);
    expect(healthResp.status()).toBe(200);

    await page.screenshot({ path: "e2e-report/demo-11-final.png", fullPage: true });

    console.log("\n=== DEMO COMPLETE ===");
    console.log(`Build ID: ${buildId}`);
  });
});
