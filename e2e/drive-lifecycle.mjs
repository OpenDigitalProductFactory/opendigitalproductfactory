/**
 * Build Studio lifecycle driver — runs outside the Playwright test runner.
 * Usage: DPF_ADMIN_PASSWORD=xxx node e2e/drive-lifecycle.mjs
 */
import { chromium } from '@playwright/test';

const PASSWORD = process.env.DPF_ADMIN_PASSWORD || 'changeme123';
const BASE = 'http://localhost:3000';
const FEATURE = 'Add a /api/v1/health endpoint that returns JSON with service status, uptime, and version';

async function shot(page, name) {
  await page.screenshot({ path: `e2e-report/drive/${name}.png`, fullPage: true });
  console.log(`[shot] ${name}`);
}

async function waitIdle(page, timeoutMs = 300000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const idle = await page.evaluate(() => {
      const ta = document.querySelector('[data-agent-panel="true"] textarea');
      return ta !== null && !ta.disabled;
    }).catch(() => false);
    if (idle) return true;
    await page.waitForTimeout(2000);
  }
  return false;
}

async function lastResponse(page) {
  return page.evaluate(() => {
    const panel = document.querySelector("[data-agent-panel='true']");
    if (!panel) return '[no panel]';
    const msgs = panel.querySelectorAll('[data-testid="agent-message"][data-message-role="assistant"]');
    if (msgs.length === 0) return '[no assistant messages]';
    const last = msgs[msgs.length - 1];
    const content = last.querySelector('[data-testid="agent-message-content"]');
    return (content ?? last)?.textContent?.trim() ?? '[empty]';
  });
}

async function sendMsg(page, msg, timeoutMs = 300000) {
  const panel = page.locator('[data-agent-panel="true"]');
  const countBefore = await page.evaluate(() =>
    document.querySelectorAll('[data-agent-panel="true"] [data-testid="agent-message"][data-message-role="assistant"]').length
  );

  const ta = panel.locator('textarea');
  await ta.fill(msg);
  const sendBtn = panel.locator('button:has-text("Send")').first();
  if (await sendBtn.isVisible({ timeout: 2000 }).catch(() => false) && await sendBtn.isEnabled()) {
    await sendBtn.click();
  } else {
    await ta.press('Enter');
  }
  console.log(`[send] >>> ${msg.slice(0, 80)}`);

  // Wait for response
  await waitIdle(page, timeoutMs);
  await page.waitForTimeout(2000);

  // Check for new message
  const countAfter = await page.evaluate(() =>
    document.querySelectorAll('[data-agent-panel="true"] [data-testid="agent-message"][data-message-role="assistant"]').length
  );

  const resp = await lastResponse(page);
  console.log(`[recv] <<< ${resp.slice(0, 200)}`);
  return resp;
}

// Main driver
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  // LOGIN
  console.log('\n=== LOGIN ===');
  await page.goto(`${BASE}/login`);
  await page.waitForSelector('input[name="email"]', { timeout: 10000 });
  await page.fill('input[name="email"]', 'admin@dpf.local');
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL(u => !u.pathname.includes('/login'), { timeout: 20000 }),
    page.click('button[type="submit"]'),
  ]);
  console.log('[drive] Logged in');

  // CREATE FEATURE
  console.log('\n=== CREATE FEATURE ===');
  await page.goto(`${BASE}/build`);
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await shot(page, '01-loaded');

  const input = page.locator('input[placeholder*="feature" i]');
  await input.fill(FEATURE);
  await page.locator('button').filter({ hasText: /^New$/i }).click();
  console.log('[drive] Feature created');

  // Wait for panel
  const panel = page.locator('[data-agent-panel="true"]');
  let panelOpen = await panel.isVisible({ timeout: 15000 }).catch(() => false);
  if (!panelOpen) {
    const fab = page.locator('button:has-text("AI Coworker")').first();
    if (await fab.isVisible({ timeout: 5000 }).catch(() => false)) await fab.click();
    panelOpen = await panel.isVisible({ timeout: 10000 }).catch(() => false);
  }
  console.log(`[drive] Panel open: ${panelOpen}`);

  // Wait for initial response
  await waitIdle(page, 120000);
  const initial = await lastResponse(page);
  console.log(`[drive] Initial: ${initial.slice(0, 200)}`);
  await shot(page, '02-initial');

  // WAIT FOR RESEARCH
  console.log('\n=== WAIT FOR RESEARCH ===');
  let hasDesign = false;
  const deadline = Date.now() + 480000; // 8 min
  while (Date.now() < deadline) {
    await page.reload({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // Click Details tab
    const tab = page.locator('button[role="tab"]:has-text("Details")').first();
    if (await tab.isVisible({ timeout: 2000 }).catch(() => false)) await tab.click();

    hasDesign = await page.locator('text=Design Research').first().isVisible({ timeout: 2000 }).catch(() => false);
    if (hasDesign) break;

    const remaining = Math.round((deadline - Date.now()) / 1000);
    console.log(`[drive] Polling for design doc... (${remaining}s left)`);
    await page.waitForTimeout(12000);
  }
  console.log(`[drive] Design doc visible: ${hasDesign}`);
  await shot(page, '03-design-doc');

  if (!hasDesign) {
    console.log('[drive] STUCK: No design doc. Aborting.');
    process.exit(1);
  }

  // CHECK REVIEW
  console.log('\n=== CHECK REVIEW ===');
  const reviewBadge = page.locator('text=/Review:.*/i').first();
  const hasReview = await reviewBadge.isVisible({ timeout: 10000 }).catch(() => false);
  const reviewText = hasReview ? await reviewBadge.textContent() : 'none';
  console.log(`[drive] Review: ${reviewText}`);
  await shot(page, '04-review');

  // BUILD ID
  const buildId = await page.evaluate(() => {
    const m = document.body.innerText.match(/FB-[A-F0-9]{8}/);
    return m?.[0] ?? null;
  });
  console.log(`[drive] Build ID: ${buildId}`);

  // TRY TO ADVANCE
  console.log('\n=== ADVANCE ===');
  // Re-open panel after reload
  if (!await panel.isVisible({ timeout: 3000 }).catch(() => false)) {
    const fab = page.locator('button:has-text("AI Coworker")').first();
    if (await fab.isVisible({ timeout: 3000 }).catch(() => false)) await fab.click();
    await panel.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  }

  if (reviewText?.includes('Needs revision')) {
    console.log('[drive] Asking agent to fix review issues...');
    await sendMsg(page, 'Fix ALL the critical and important review issues. Then resubmit for review.', 300000);
    await shot(page, '05-after-fix');
  } else if (reviewText === 'none' || !hasReview) {
    console.log('[drive] No review yet — asking agent to submit for review and advance...');
    await sendMsg(page, 'Submit the design for review. Then complete taxonomy placement, create a backlog item and epic, and advance to the plan phase.', 300000);
    await shot(page, '05-advance-attempt');
  } else {
    console.log('[drive] Asking agent to advance to plan...');
    await sendMsg(page, 'Advance to the plan phase.', 120000);
    await shot(page, '05-advance');
  }

  // FINAL STATE
  await page.reload({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
  const phase = await page.evaluate(() => {
    const items = document.querySelectorAll('nav[aria-label="Build phase progress"] [aria-label]');
    for (const item of items) {
      if (item.getAttribute('aria-label')?.includes('current'))
        return item.getAttribute('aria-label').replace(': current', '');
    }
    return 'unknown';
  });
  await shot(page, '06-final');

  console.log('\n========================================');
  console.log(`BUILD ID: ${buildId}`);
  console.log(`DESIGN DOC: ${hasDesign}`);
  console.log(`REVIEW: ${reviewText}`);
  console.log(`FINAL PHASE: ${phase}`);
  console.log('========================================\n');

} catch (err) {
  console.error('[drive] ERROR:', err.message);
  await shot(page, 'error').catch(() => {});
} finally {
  await browser.close();
}
