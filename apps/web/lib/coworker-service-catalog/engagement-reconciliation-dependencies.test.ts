import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ dependenciesLoaded: false }));
vi.mock("@/lib/shared/execution-uncertainty", async () => {
  await new Promise(resolve => setTimeout(resolve, 20));
  state.dependenciesLoaded = true;
  return { hasExecutionUncertainty: () => false };
});
import { reconcileEngagementTaskResult } from "./engagement-fulfillment";
it("loads cold dependencies before opening the result-return transaction", async () => {
  const tx = { $queryRaw: async () => [], taskRun: { findUnique: async () => null } };
  const database = { $transaction: async (work: (db: typeof tx) => Promise<void>) => {
    expect(state.dependenciesLoaded).toBe(true);
    return work(tx);
  } };
  await reconcileEngagementTaskResult("TR-ORIGINAL", database as never);
});
