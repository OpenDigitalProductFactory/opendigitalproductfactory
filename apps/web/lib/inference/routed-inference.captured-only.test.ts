import { expect, it, vi } from "vitest";
const effects = vi.hoisted(() => ({ fallback: vi.fn(), manifests: vi.fn(async () => []), reconcile: vi.fn(async (fn: () => Promise<unknown>) => fn()) }));
vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("../routing/loader", () => ({ loadEndpointManifests: effects.manifests, loadPolicyRules: async () => [], loadOverrides: async () => [], invalidateRoutingLoaderCache: vi.fn() }));
vi.mock("../routing/fallback", () => ({ callWithFallbackChain: effects.fallback }));
vi.mock("./provider-reconciliation", () => ({ withProviderReconciliationRetry: effects.reconcile }));
vi.mock("./local-model-context-reconcile", () => ({ resolveLocalRoutingRuntime: vi.fn() }));
vi.mock("./local-only", () => ({ getLocalOnlyInference: async () => false, getLocalOnlyInferenceFresh: async () => false }));
import { routeAndCall } from "./routed-inference";
import { withCapturedProviderTransportOnly, assertCapturedProviderTransportClean } from "../shared/captured-effect-store";
it("refuses ordinary routed inference before selection, provider reconciliation, CLI dispatch or fallback", async () => {
  await withCapturedProviderTransportOnly(async () => {
    await expect(routeAndCall([{ role: "user", content: "Uncaptured continuation" }], "Persona", "internal"))
      .rejects.toThrow("capture-provider-transport-required");
    expect(() => assertCapturedProviderTransportClean()).toThrow("capture-unmediated-provider-attempt");
  });
  expect(effects.manifests).not.toHaveBeenCalled(); expect(effects.reconcile).not.toHaveBeenCalled(); expect(effects.fallback).not.toHaveBeenCalled();
});
