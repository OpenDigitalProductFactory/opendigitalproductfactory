import { test as base, expect, type Page } from "@playwright/test";
import { attachFunctionalFailureEvidence } from "./evidence";

type DpfFixtures = {
  openAppRoute: (route: string) => Promise<void>;
  openCoworkerPanel: () => Promise<void>;
  expectNotRedirectedToWelcome: () => Promise<void>;
  attachRouteFailure: (input: {
    testId: string;
    suite: string;
    route: string;
    expected: string;
    actual: string;
    agentId?: string | null;
  }) => Promise<void>;
};

export const test = base.extend<DpfFixtures>({
  openAppRoute: async ({ page }, use) => {
    await use(async (route: string) => {
      await page.goto(route);
      await expect(page).not.toHaveURL(/\/welcome|\/login/);
    });
  },
  openCoworkerPanel: async ({ page }, use) => {
    await use(async () => {
      const panel = page.locator('[data-agent-panel="true"]');
      const button = page
        .getByRole("button", { name: /open ai co-?worker|ai co-?worker|co-?worker/i })
        .first();

      if (
        !(await panel.isVisible({ timeout: 1_000 }).catch(() => false)) &&
        (await button.isVisible().catch(() => false))
      ) {
        await button.click();
      }

      await expect(panel).toBeVisible({ timeout: 10_000 });
    });
  },
  expectNotRedirectedToWelcome: async ({ page }, use) => {
    await use(async () => {
      await expect(page).not.toHaveURL(/\/welcome|\/login/);
    });
  },
  attachRouteFailure: async ({}, use, testInfo) => {
    await use(async (input) => {
      await attachFunctionalFailureEvidence(testInfo, {
        ...input,
        screenshotPath:
          testInfo.attachments.find((attachment) => attachment.contentType === "image/png")?.path ??
          null,
        tracePath: null,
        userRole: "admin",
        routeContext: input.route,
        agentId: input.agentId ?? null,
        reproCommand: `pnpm test:e2e -- --project=${input.suite} -g ${input.testId}`,
      });
    });
  },
});

export { expect };
export type { Page };
