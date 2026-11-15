import { expect, type Browser } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { quotaMeasurementStatus, readQuotaControlState, waitForQuotaControlSettlement } from "./provider-quota-recovery-settlement";

/** Real browser regressions run in the existing governed UX job, not unit CI.
 * Every page is local fixture HTML; this sends no provider or portal requests. */
export async function verifyQuotaControlSettlement(browser: Browser, expression: string) {
  const cases: string[] = [];
  async function run(name: string, check: () => Promise<void>) {
    await check(); cases.push(name);
  }
  for (const duration of [150, 1400]) {
    await run(`measures an enabled settled control after a ${duration}ms opacity transition`, async () => {
      const page = await browser.newPage();
      try {
        await page.setContent(`<style>
          button { background:#2563eb; color:white; opacity:1;
            transition:opacity ${duration}ms linear; font:14px sans-serif; }
          button:disabled { opacity:0.6; }
        </style><button disabled aria-busy="true">Check now</button>`);
        await page.locator("button").evaluate((button, holdTransition) => {
          // Establish the pending computed style before the result arrives.
          getComputedStyle(button).opacity;
          (button as HTMLButtonElement).disabled = false;
          button.removeAttribute("aria-busy");
          getComputedStyle(button).opacity;
          if (holdTransition) {
            for (const animation of button.getAnimations()) {
              animation.playbackRate = 0;
              animation.currentTime = 200;
            }
          }
        }, duration === 1400);
        await page.evaluate(expression!);
        const beforeVisualBoundary = await page.locator("button").evaluate(button => ({
          opacity: Number(getComputedStyle(button).opacity),
          animations: button.getAnimations().filter(animation => animation.playState === "running").length,
        }));
        if (duration === 1400) {
          expect(beforeVisualBoundary.opacity).toBeLessThan(1);
          expect(beforeVisualBoundary.animations).toBeGreaterThan(0);
        }
        if (duration === 1400) {
          // Hold the real CSS transition so host load cannot turn the stress
          // counterexample into an already-finished animation before observation.
          await page.locator("button").evaluate(button => {
            const original = button.getAnimations.bind(button);
            (window as unknown as { settlementReads: number }).settlementReads = 0;
            Object.defineProperty(button, "getAnimations", { value(options?: GetAnimationsOptions) {
              (window as unknown as { settlementReads: number }).settlementReads++;
              return original(options);
            } });
          });
          const settled = waitForQuotaControlSettlement(page.locator("button"), 3000);
          await page.waitForFunction(() => (window as unknown as { settlementReads: number }).settlementReads > 0);
          await page.locator("button").evaluate(button => {
            for (const animation of button.getAnimations()) {
              animation.playbackRate = 1;
              animation.finish();
            }
          });
          expect(await settled).toMatchObject({ opacity: 1, animations: 0 });
        } else {
          await waitForQuotaControlSettlement(page.locator("button"), 3000);
        }
        const observed = await page.locator("button").evaluate(button => ({
          disabled: (button as HTMLButtonElement).disabled,
          busy: button.getAttribute("aria-busy"),
          opacity: Number(getComputedStyle(button).opacity),
          animations: button.getAnimations().filter(animation =>
            animation.playState === "running" || animation.pending).length,
        }));
        // The 1400ms case is an explicit stress fixture, not a claim that the
        // preserved CI run used this duration or retained these measured states.
        expect(observed).toEqual({ disabled: false, busy: null, opacity: 1, animations: 0 });
      } finally { await page.close(); }
    });
  }
  await run("refuses a control that remains disabled rather than silently measuring it", async () => {
    const page = await browser.newPage();
    try {
      await page.setContent('<button disabled aria-busy="true">Check now</button>');
      await expect(waitForQuotaControlSettlement(page.locator("button"), 200)).rejects.toThrow();
      expect(await page.locator("button").isDisabled()).toBe(true);
    } finally { await page.close(); }
  });
  await run("still exposes genuine settled enabled-state contrast failures to axe", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.setContent('<button style="background:#7ca1f3;color:white;font:14px sans-serif">Check now</button>');
      const measured = await waitForQuotaControlSettlement(page.locator("button"));
      expect(measured).toMatchObject({ disabled: false, busy: false, opacity: 1, animations: 0 });
      const result = await new AxeBuilder({ page }).include("button").analyze();
      expect(result.violations.some(violation => violation.id === "color-contrast")).toBe(true);
    } finally { await context.close(); }
  });
  await run("a post-axe state change cannot publish passed with zero violations", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.setContent('<button style="background:#2563eb;color:white;font:14px sans-serif">Check now</button>');
      await waitForQuotaControlSettlement(page.locator("button"));
      const result = await new AxeBuilder({ page }).include("button").analyze();
      const serious = result.violations.filter(value => value.impact === "serious" || value.impact === "critical");
      expect(serious).toHaveLength(0);
      await page.locator("button").evaluate(button => { (button as HTMLButtonElement).disabled = true; });
      expect(quotaMeasurementStatus(serious.length, await readQuotaControlState(page.locator("button")))).toBe("failed");
    } finally { await context.close(); }
  });
  return { status: "passed", providerRequests: 0, cases };
}
