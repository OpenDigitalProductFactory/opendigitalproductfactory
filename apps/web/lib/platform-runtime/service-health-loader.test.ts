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
  it("joins catalog-owned providers to reconciled provider health", async () => {
    const loadProviderHealth = vi.fn().mockResolvedValue({
      status: "degraded",
      remediationKind: "provider_settings",
      safeSummary: "Recent requests are failing. Check this provider's settings.",
      adminActionHref: "/platform/ai/providers/openai",
    });
    const result = await loadCapabilityServiceHealth({
      loadOperationalState: vi.fn().mockResolvedValue(operational),
      readConfiguredProviderIds: vi.fn().mockResolvedValue(["openai", "custom-not-in-catalog"]),
      loadProviderHealth,
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        key: "openai",
        label: "External — provider managed",
        availability: "unavailable",
        detail: "Recent requests are failing. Check this provider's settings.",
        action: "Open provider settings to restore availability.",
        actionHref: "/platform/ai/providers/openai",
      }),
    ]);
    expect(loadProviderHealth).toHaveBeenCalledTimes(1);
    expect(loadProviderHealth).toHaveBeenCalledWith("openai");
  });

  it("preserves no-recent-signal provider health as unknown", async () => {
    const result = await loadCapabilityServiceHealth({
      loadOperationalState: vi.fn().mockResolvedValue(operational),
      readConfiguredProviderIds: vi.fn().mockResolvedValue(["openai"]),
      loadProviderHealth: vi.fn().mockResolvedValue({
        status: "unknown",
        remediationKind: "none",
        safeSummary: "No recent activity. Health will update after the next request.",
      }),
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        key: "openai",
        availability: "unknown",
        detail: "No recent activity. Health will update after the next request.",
        action: "Run a request to establish current provider health.",
      }),
    ]);
  });
});
