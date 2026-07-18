import { describe, expect, it, vi } from "vitest";

import type { OperationalCapabilityState } from "./operational-state";
import { loadCapabilityServiceHealth } from "./service-health-loader";

const operational = {
  serviceRequirements: [],
  serviceStates: {},
  observedServices: {},
  externalRuntimes: [
    { capability: "runtime:external-ai", runtimeKey: "openai", healthSemantics: "provider-api" },
  ],
  providerState: {},
} as OperationalCapabilityState;

describe("loadCapabilityServiceHealth", () => {
  it("joins configured providers only through catalog-owned runtime keys", async () => {
    const result = await loadCapabilityServiceHealth({
      loadOperationalState: vi.fn().mockResolvedValue(operational),
      readProviders: vi.fn().mockResolvedValue([
        { providerId: "openai", status: "active" },
        { providerId: "custom-not-in-catalog", status: "active" },
        { providerId: "disabled", status: "disabled" },
      ]),
    });

    expect(result.items).toEqual([
      expect.objectContaining({ key: "openai", label: "External — provider managed" }),
    ]);
  });
});
