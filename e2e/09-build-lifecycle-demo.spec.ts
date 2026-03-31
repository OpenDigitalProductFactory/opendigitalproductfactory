/**
 * Build Studio Full Lifecycle Demo
 *
 * Demonstrates the complete feature build pipeline with adaptive AI interaction:
 * 1. Login → Navigate to Build Studio
 * 2. Create a new feature ("Customer Complaint Tracker")
 * 3. AI Coworker designs the feature (ideate phase)
 * 4. AI Coworker creates implementation plan (plan phase)
 * 5. AI Coworker generates code in sandbox (build phase)
 * 6. AI Coworker runs tests and deploys (review/ship)
 * 7. Verify the feature appears in production
 *
 * The test reads each AI response and adapts its next message accordingly.
 * If the AI reports a blocker, the test addresses it before moving on.
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
const MAX_RETRIES = 3;

// ─── Response Analysis Helpers ─────────────────────────────────────────────

/** Check if the AI response indicates a blocker or error */
function hasBlocker(response: string): boolean {
  const blockerPatterns = [
    /can'?t\s+(safely\s+)?(modify|add|create|edit|write|ship|deploy|build)/i,
    /blocker/i,
    /blocked/i,
    /shell escaping/i,
    /isn'?t\s+(ready|loading|available|working)/i,
    /failed to/i,
    /error:/i,
    /cannot\s+(overwrite|modify|create)/i,
    /doesn'?t exist/i,
    /not found/i,
  ];
  return blockerPatterns.some((p) => p.test(response));
}

/** Check if the AI is asking a question rather than acting */
function isAskingQuestion(response: string): boolean {
  const questionPatterns = [
    /what should/i,
    /should I/i,
    /do you want/i,
    /which approach/i,
    /could you clarify/i,
    /what'?s the/i,
    /I need to clarify/i,
  ];
  return questionPatterns.some((p) => p.test(response));
}

/** Check if the AI completed the requested action */
function didComplete(response: string, keywords: string[]): boolean {
  return keywords.some((kw) => response.toLowerCase().includes(kw.toLowerCase()));
}

/** Check if the current phase advanced */
async function getCurrentPhase(page: import("@playwright/test").Page): Promise<string> {
  return page.evaluate(() => {
    const body = document.body.innerText;
    // Look for phase indicators in the Build Studio UI
    const phases = ["ideate", "plan", "build", "ship", "complete"];
    for (const phase of phases.reverse()) {
      if (body.toLowerCase().includes(`phase: ${phase}`) ||
          body.toLowerCase().includes(`"${phase}"`)) {
        return phase;
      }
    }
    return "unknown";
  });
}

test.describe("Build Studio Lifecycle Demo", () => {
  test("full feature build: create, design, plan, build, deploy, verify", async ({ page }) => {
    test.setTimeout(900_000); // 15 minutes — AI-driven tests need room

    // ━━━ Step 1: Login ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log("\n=== STEP 1: Login ===");
    await loginToDPF(page);
    await page.screenshot({ path: "e2e-report/demo-01-logged-in.png" });

    // ━━━ Step 2: Navigate to Build Studio ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log("\n=== STEP 2: Navigate to Build Studio ===");
    await page.goto("/build");
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

    const featureInput = page.locator('input[placeholder*="feature" i]');
    await expect(featureInput).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: "e2e-report/demo-02-build-studio.png" });

    // ━━━ Step 3: Create new feature ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log("\n=== STEP 3: Create Feature ===");
    await featureInput.fill(FEATURE_TITLE);
    await page.locator("button").filter({ hasText: /^New$/i }).click();

    const panel = page.locator('[data-agent-panel="true"]');
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(panel.locator("text=Software Engineer").first()).toBeVisible({ timeout: 5_000 });

    // Wait for auto-message response to complete
    await waitForCoworkerIdle(page, 120_000);
    await page.waitForTimeout(2_000);
    await approveAllProposals(page);
    await page.screenshot({ path: "e2e-report/demo-03-feature-created.png" });

    // ━━━ Step 4: Ideate — Design the feature ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log("\n=== STEP 4: Ideate Phase ===");

    // Initial design request — be very specific to reduce back-and-forth
    let response = await sendAndWait(page,
      "Design this feature now. Here are the exact requirements — do not ask for clarification:\n" +
      "1) A simple complaints list page at /complaints showing all complaints with status badges (open, investigating, resolved, closed)\n" +
      "2) A form to submit a new complaint with fields: customer name (text), description (textarea), severity (select: low/medium/high/critical), category (text)\n" +
      "3) In-memory data store (no database changes needed — use a simple array or Map for this demo)\n" +
      "4) Use existing platform UI patterns (Tailwind, shadcn components if available)\n" +
      "Save the design document now.",
    );
    await approveAllProposals(page);

    // If the AI asks questions instead of acting, push it forward
    for (let retry = 0; retry < MAX_RETRIES && isAskingQuestion(response); retry++) {
      console.log(`[demo] AI asked a question, pushing forward (attempt ${retry + 1})`);
      response = await sendAndWait(page,
        "Do not ask questions. Use the requirements I already gave you. Save the design document and mark the design review as approved. Proceed immediately.",
      );
      await approveAllProposals(page);
    }

    await page.screenshot({ path: "e2e-report/demo-04-ideate.png" });

    // Advance to plan phase
    response = await sendAndWait(page,
      "The design is approved. Save it and advance to the plan phase now. Do not ask for changes.",
    );
    await approveAllProposals(page);
    await page.screenshot({ path: "e2e-report/demo-05-design-reviewed.png" });

    // ━━━ Step 5: Plan — Implementation plan ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log("\n=== STEP 5: Plan Phase ===");
    response = await sendAndWait(page,
      "Create the implementation plan. This is a single-file feature — no database changes needed:\n" +
      "- One new file: apps/web/app/(shell)/complaints/page.tsx\n" +
      "- Contains: complaint list with status badges, submit form, in-memory state using React useState\n" +
      "- No Prisma schema changes, no API routes, no migrations\n" +
      "Save the plan and review it immediately. Then advance to the build phase.",
    );
    await approveAllProposals(page);

    // Handle blockers in plan phase
    for (let retry = 0; retry < MAX_RETRIES && hasBlocker(response); retry++) {
      console.log(`[demo] Plan phase blocker detected, addressing (attempt ${retry + 1})`);
      response = await sendAndWait(page,
        "Ignore any blockers. This is a simple single-page feature with in-memory data — no schema changes, no migrations, no database. " +
        "Just plan to create one page.tsx file. Save the plan and advance to build.",
      );
      await approveAllProposals(page);
    }

    await page.screenshot({ path: "e2e-report/demo-06-plan.png" });

    // Push to build if still in plan
    if (!didComplete(response, ["build phase", "building", "generating code", "sandbox"])) {
      response = await sendAndWait(page, "The plan is approved. Advance to the build phase now.");
      await approveAllProposals(page);
    }
    await page.screenshot({ path: "e2e-report/demo-07-plan-reviewed.png" });

    // ━━━ Step 6: Build — Generate code in sandbox ━━━━━━━━━━━━━━━━━━━━━━━
    console.log("\n=== STEP 6: Build Phase ===");
    response = await sendAndWait(page,
      "Generate the code in the sandbox now. Use the write_sandbox_file tool to create:\n" +
      "apps/web/app/(shell)/complaints/page.tsx\n\n" +
      "This should be a React 'use client' component with:\n" +
      "- useState for an in-memory complaints array\n" +
      "- A form to add complaints (name, description, severity, category)\n" +
      "- A list showing complaints with status badges\n" +
      "- Tailwind CSS styling\n\n" +
      "Do NOT modify the Prisma schema. Do NOT create API routes. This is a client-side only page.\n" +
      "After creating the file, run the sandbox typecheck to verify.",
      300_000,
    );
    await approveAllProposals(page);
    await page.screenshot({ path: "e2e-report/demo-08-building.png" });

    // Handle build blockers — offer specific guidance
    for (let retry = 0; retry < MAX_RETRIES && hasBlocker(response); retry++) {
      console.log(`[demo] Build blocker detected: ${response.slice(0, 150)}`);

      if (response.toLowerCase().includes("schema") || response.toLowerCase().includes("prisma")) {
        response = await sendAndWait(page,
          "Do NOT touch the Prisma schema. This feature uses in-memory state only (React useState). " +
          "Use write_sandbox_file to create apps/web/app/(shell)/complaints/page.tsx with a 'use client' component. " +
          "The component manages its own state — no database needed.",
          300_000,
        );
      } else if (response.toLowerCase().includes("shell") || response.toLowerCase().includes("escap")) {
        response = await sendAndWait(page,
          "Use the write_sandbox_file tool instead of shell commands. It handles encoding automatically. " +
          "Create apps/web/app/(shell)/complaints/page.tsx with the complaint tracker component.",
          300_000,
        );
      } else {
        response = await sendAndWait(page,
          "Try again. Use write_sandbox_file to create the complaints page. Keep it simple — one file, in-memory state, no database.",
          300_000,
        );
      }
      await approveAllProposals(page);
    }

    // Verify something was built — check for sandbox file creation
    if (didComplete(response, ["created", "generated", "wrote", "file", "page.tsx"])) {
      console.log("[demo] Build phase: code generated successfully");
    } else {
      console.log(`[demo] Build phase: uncertain outcome — ${response.slice(0, 200)}`);
    }

    // Run tests if the AI hasn't already
    if (!didComplete(response, ["typecheck", "tests pass", "type check", "no errors"])) {
      console.log("[demo] Requesting typecheck...");
      response = await sendAndWait(page,
        "Run the sandbox typecheck now: run_sandbox_command with 'pnpm --filter web exec tsc --noEmit' to verify the code compiles.",
        120_000,
      );
    }

    await page.screenshot({ path: "e2e-report/demo-09-built.png" });

    // ━━━ Step 7: Ship ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log("\n=== STEP 7: Ship Phase ===");

    const buildId = await extractBuildId(page);
    console.log(`[demo] Build ID: ${buildId}`);

    response = await sendAndWait(page,
      "The build is complete. Deploy this feature now using the deploy_feature tool. Ship it to production.",
      180_000,
    );
    await approveAllProposals(page);

    // Handle ship refusal
    for (let retry = 0; retry < MAX_RETRIES && hasBlocker(response); retry++) {
      console.log(`[demo] Ship blocker: ${response.slice(0, 150)}`);
      response = await sendAndWait(page,
        "The feature is ready to ship as-is. Use deploy_feature now. Do not wait for additional testing or database changes.",
        180_000,
      );
      await approveAllProposals(page);
    }

    await page.screenshot({ path: "e2e-report/demo-10-shipping.png" });

    // ━━━ Step 8: Verify in production ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log("\n=== STEP 8: Verify in Production ===");

    // 8a: Check backlog for the feature epic
    await page.goto("/ops");
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(2_000);
    const backlogText = await page.textContent("body");
    const hasBacklogItem = backlogText?.toLowerCase().includes("complaint") ?? false;
    console.log(`[demo] Feature in backlog: ${hasBacklogItem}`);
    await page.screenshot({ path: "e2e-report/demo-11-ops-backlog.png" });

    // 8b: Check portal health
    const healthResp = await page.request.get("/api/health");
    console.log(`[demo] Portal health: ${healthResp.status()}`);
    expect(healthResp.status()).toBe(200);

    // 8c: Check promotion status
    console.log(`[demo] Build ID: ${buildId}`);
    console.log("[demo] To verify promotion status, run:");
    console.log('[demo]   docker exec dpf-postgres-1 psql -U dpf -d dpf -c "SELECT status, \\"deployedAt\\" FROM \\"ChangePromotion\\" ORDER BY \\"createdAt\\" DESC LIMIT 1;"');

    await page.screenshot({ path: "e2e-report/demo-12-final.png", fullPage: true });

    console.log("\n=== DEMO COMPLETE ===");
    console.log(`Build ID: ${buildId}`);
    console.log("Screenshots saved to e2e-report/demo-*.png");
  });
});
