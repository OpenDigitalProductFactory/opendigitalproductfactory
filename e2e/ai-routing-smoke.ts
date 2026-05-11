import type { Page } from "@playwright/test";
import { ROUTE_CONTRACTS, type RouteContractFamily } from "../apps/web/lib/testing/route-contracts";
import { expect } from "./fixtures/dpf-test";

export function getRouteContract(family: RouteContractFamily) {
  const contract = ROUTE_CONTRACTS.find((entry) => entry.family === family);

  if (!contract) {
    throw new Error(`Missing route contract for ${family}`);
  }

  return contract;
}

export async function expectRouteCoworker(page: Page, expectedLabel: string) {
  const panel = page.locator('[data-agent-panel="true"]');
  await expect(panel).toBeVisible({ timeout: 10_000 });
  await expect(panel.getByText(expectedLabel, { exact: false }).first()).toBeVisible({
    timeout: 10_000,
  });

  await expect(panel.getByText(/i cannot proceed|my tools are limited|noeligibleendpoints/i)).toHaveCount(0);
}
