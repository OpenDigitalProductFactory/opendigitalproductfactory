// Phase 15: Authority & Governance — Playwright E2E Tests
// Run: node tests/e2e/auth-gov-phase15.mjs

import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const results = [];

function log(id, desc, pass, detail = "") {
  const status = pass ? "PASS" : "FAIL";
  results.push({ id, desc, status, detail });
  console.log(`${status} | ${id} | ${desc}${detail ? " — " + detail : ""}`);
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Login
  console.log("--- Logging in ---");
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', "admin@dpf.local");
  await page.fill('input[name="password"]', "changeme123");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/workspace**", { timeout: 10000 }).catch(() => {});
  const loggedIn = page.url().includes("/workspace");
  if (!loggedIn) {
    console.log("Login failed, URL:", page.url());
    // Try alternate: might redirect elsewhere
    await page.waitForTimeout(2000);
  }
  console.log("Logged in, at:", page.url());
  console.log("");

  // AUTH-GOV-01: Navigate to /platform/ai/authority
  console.log("--- Phase 15: Authority & Governance ---");
  await page.goto(`${BASE}/platform/ai/authority`);
  await page.waitForTimeout(2000);
  const title = await page.textContent("h1").catch(() => "");
  log("AUTH-GOV-01", "Authority page loads", title.includes("Authority"));

  // AUTH-GOV-02: Agent authority cards visible
  const matrixSection = await page.textContent("body").catch(() => "");
  log("AUTH-GOV-02", "Authority Matrix section present", matrixSection.includes("Authority Matrix"));

  // AUTH-GOV-03: Delegation Chain section
  log("AUTH-GOV-03", "Delegation Chain section present", matrixSection.includes("Delegation Chain"));

  // AUTH-GOV-04: Effective Permissions Inspector present
  log("AUTH-GOV-04", "Effective Permissions Inspector present", matrixSection.includes("Effective Permissions"));

  // AUTH-GOV-05: Tool Execution Log section
  log("AUTH-GOV-05", "Tool Execution Log section present", matrixSection.includes("Tool Execution Log"));

  // AUTH-GOV-06: Authority Matrix - verify it renders with grant category columns
  await page.waitForTimeout(3000);
  let matrixRendered = false;
  try {
    const html = await page.innerHTML("body");
    // Matrix should have grant category headers and be visible
    const hasBacklog = html.includes("Backlog");
    const hasSecurity = html.includes("Security");
    const hasDeploy = html.includes("Deploy");
    // Also confirm the matrix panel rendered (screenshot confirmed visual grid)
    const hasMatrixSection = html.includes("Authority Matrix");
    matrixRendered = hasMatrixSection && hasBacklog && (hasSecurity || hasDeploy);
  } catch { /* no-op */ }
  log("AUTH-GOV-06", "Authority Matrix renders with category columns", matrixRendered);

  // AUTH-GOV-07: Effective Permissions - verify select dropdowns render with options
  // Re-navigate to ensure fresh hydration
  await page.goto(`${BASE}/platform/ai/authority`);
  await page.waitForTimeout(3000);
  const selects = await page.$$("select");
  let selectsWorked = false;
  let selectDetail = `${selects.length} selects found`;
  try {
    if (selects.length >= 2) {
      // Count options in each select to verify they're populated
      const optCounts = [];
      for (const sel of selects) {
        const opts = await sel.$$("option");
        optCounts.push(opts.length);
      }
      selectDetail = `${selects.length} selects, option counts: [${optCounts.join(",")}]`;
      // At least 2 selects with more than 1 option each = roles and agents populated
      const populatedSelects = optCounts.filter((c) => c > 1).length;
      selectsWorked = populatedSelects >= 2;
    }
  } catch { /* no-op */ }
  log("AUTH-GOV-07", "Effective Permissions dropdowns populated", selectsWorked, selectDetail);

  // AUTH-GOV-08: History page still works
  await page.goto(`${BASE}/platform/ai/history`);
  await page.waitForTimeout(1500);
  const historyTitle = await page.textContent("h1").catch(() => "");
  log("AUTH-GOV-08", "History page loads", historyTitle.includes("Action History") || historyTitle.includes("History"));

  // AUTH-GOV-09: Authority tab in tab nav
  await page.goto(`${BASE}/platform/ai`);
  await page.waitForTimeout(1500);
  const navLinks = await page.$$eval("a", (links) =>
    links.map((l) => ({ text: l.textContent, href: l.href }))
  );
  const authorityTab = navLinks.find((l) => l.text === "Authority" && l.href.includes("/authority"));
  log("AUTH-GOV-09", "Authority tab in nav", !!authorityTab);

  // AUTH-GOV-10: AI Workforce page shows agent cards with grants
  const workforceBody = await page.textContent("body").catch(() => "");
  const hasGrants = workforceBody.includes("Tool grants");
  const hasHitl = workforceBody.includes("HITL tier");
  const hasEscalation = workforceBody.includes("Escalates to");
  log("AUTH-GOV-10", "Agent cards show governance data", hasGrants && hasHitl, `grants:${hasGrants} hitl:${hasHitl} escalation:${hasEscalation}`);

  // AUTH-GOV-11: Click Authority tab navigates correctly
  if (authorityTab) {
    await page.click('a[href*="/authority"]');
    await page.waitForTimeout(1500);
    const url = page.url();
    log("AUTH-GOV-11", "Authority tab navigates to authority page", url.includes("/authority"));
  } else {
    log("AUTH-GOV-11", "Authority tab navigates to authority page", false, "tab not found");
  }

  // Summary
  console.log("");
  console.log("--- SUMMARY ---");
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  console.log(`${passed} PASS | ${failed} FAIL | ${results.length} total`);

  if (failed > 0) {
    console.log("\nFailed tests:");
    results.filter((r) => r.status === "FAIL").forEach((r) => {
      console.log(`  ${r.id}: ${r.desc}${r.detail ? " — " + r.detail : ""}`);
    });
  }

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Test runner error:", err.message);
  process.exit(1);
});
