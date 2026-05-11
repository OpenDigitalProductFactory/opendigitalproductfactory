import { test, expect } from "./fixtures/dpf-test";
import { expectRouteCoworker, getRouteContract } from "./ai-routing-smoke";

const contract = getRouteContract("discovery");

test.describe("AI routing smoke: Discovery", () => {
  test(`${contract.expectedAgentId} is visible on ${contract.route}`, async ({
    page,
    openAppRoute,
    openCoworkerPanel,
    attachRouteFailure,
  }) => {
    try {
      await openAppRoute(contract.route);
      await openCoworkerPanel();
      await expectRouteCoworker(page, contract.expectedLabel);
    } catch (error) {
      await page.screenshot({ fullPage: true });
      await attachRouteFailure({
        testId: "DISCOVERY-AI-ROUTING-01",
        suite: "discovery",
        route: contract.route,
        expected: `${contract.expectedAgentId} (${contract.expectedLabel}) coworker visible`,
        actual: String(error),
        agentId: contract.expectedAgentId,
      });
      throw error;
    }

    await expect(page).not.toHaveURL(/\/welcome|\/login/);
  });
});
