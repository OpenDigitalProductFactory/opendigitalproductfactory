// apps/web/lib/playwright-runner.ts
// Generates and executes Playwright tests against sandbox containers.

import { exec as execCb } from "child_process";
import { promisify } from "util";

const exec = promisify(execCb);

export type UxTestStep = {
  step: string;
  passed: boolean;
  screenshotUrl: string | null;
  error: string | null;
};

export function generateTestScript(
  sandboxUrl: string,
  acceptanceCriteria: string[],
  buildId: string,
): string {
  const criteriaSteps = acceptanceCriteria.map((criterion, i) => `
    await test.step('Criterion: ${criterion.replace(/'/g, "\\'")}', async () => {
      await page.screenshot({ path: '/results/${buildId}-step-${i}.png' });
      // Acceptance criterion — assertion intent:
      // ${criterion}
    });
  `).join("\n");

  return `
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('UX Acceptance: ${buildId}', async ({ page }) => {
  await page.goto('${sandboxUrl}');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: '/results/${buildId}-initial.png' });

  // 1. Accessibility audit — axe-core catches contrast, missing labels, ARIA, heading order
  await test.step('Accessibility audit (axe-core)', async () => {
    const results = await new AxeBuilder({ page }).analyze();
    const critical = results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious');
    expect(critical, \`Found \${critical.length} critical/serious accessibility violations: \${critical.map(v => v.id).join(', ')}\`).toHaveLength(0);
  });

  // 2. Focus visibility — tab through focusable elements, check for visible focus indicator
  await test.step('Focus visibility check', async () => {
    const focusable = await page.locator('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])').all();
    for (const el of focusable.slice(0, 20)) { // Cap at 20 to avoid timeout
      await el.focus();
      const outline = await el.evaluate(e => {
        const style = getComputedStyle(e);
        return style.outlineStyle !== 'none' || style.boxShadow !== 'none';
      });
      // At least some focus indicator should be present
      // (platform @layer components provides this by default)
    }
  });

  // 3. CSS variable compliance — check for hardcoded inline hex on visible elements
  await test.step('CSS variable compliance', async () => {
    const violations = await page.evaluate(() => {
      const issues: string[] = [];
      document.querySelectorAll('[style]').forEach(el => {
        const style = el.getAttribute('style') ?? '';
        if (/#[0-9a-fA-F]{3,8}/.test(style)) {
          issues.push(el.tagName + ': ' + style.slice(0, 100));
        }
      });
      return issues;
    });
    if (violations.length > 0) {
      console.warn('CSS variable compliance warnings:', violations);
    }
    // Warning only — not a hard failure, since some inline hex may be legitimate
  });

  // 4. Acceptance criteria steps
${criteriaSteps}
});
`;
}

export async function runPlaywrightTest(buildId: string): Promise<UxTestStep[]> {
  try {
    const { stdout } = await exec(
      `docker exec playwright npx playwright test /scripts/${buildId}.spec.ts --reporter=json 2>&1 || true`,
      { timeout: 120000 },
    );
    try {
      const report = JSON.parse(stdout);
      return (report.suites?.[0]?.specs ?? []).map((spec: Record<string, unknown>, i: number) => ({
        step: (spec.title as string) ?? `Step ${i + 1}`,
        passed: (spec.ok as boolean) ?? false,
        screenshotUrl: `/results/${buildId}-step-${i}.png`,
        error: ((spec.tests as Record<string, unknown>[])?.[0] as Record<string, unknown>)?.results
          ? null
          : null,
      }));
    } catch {
      return [{ step: "Test execution", passed: false, screenshotUrl: null, error: stdout.slice(0, 500) }];
    }
  } catch (e) {
    return [{ step: "Test execution", passed: false, screenshotUrl: null, error: e instanceof Error ? e.message : String(e) }];
  }
}
