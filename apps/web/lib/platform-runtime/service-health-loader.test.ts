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
      readProviderConfigurations: vi.fn().mockResolvedValue([
        { providerId: "openai", status: "active" },
        { providerId: "custom-not-in-catalog", status: "active" },
      ]),
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
      readProviderConfigurations: vi.fn().mockResolvedValue([
        { providerId: "openai", status: "active" },
      ]),
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

  it("keeps a disabled configured provider visible with reconciled reauthentication guidance", async () => {
    const loadProviderHealth = vi.fn().mockResolvedValue({
      status: "needs_reauth",
      remediationKind: "reauth",
      safeSummary: "Needs re-authentication. Reconnect this provider to restore access.",
      adminActionHref: "/platform/ai/providers/openai",
    });
    const result = await loadCapabilityServiceHealth({
      loadOperationalState: vi.fn().mockResolvedValue({
        ...operational,
        externalRuntimes: [
          ...operational.externalRuntimes,
          { capability: "runtime:external-ai", runtimeKey: "anthropic", healthSemantics: "provider-api" },
          { capability: "runtime:external-ai", runtimeKey: "gemini", healthSemantics: "provider-api" },
        ],
      }),
      readProviderConfigurations: vi.fn().mockResolvedValue([
        { providerId: "openai", status: "disabled" },
        { providerId: "anthropic", status: "unconfigured" },
        { providerId: "gemini", status: "inactive" },
      ]),
      loadProviderHealth,
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        key: "openai",
        label: "External — provider managed",
        availability: "unavailable",
        detail: "Needs re-authentication. Reconnect this provider to restore access.",
        action: "Reconnect this provider to restore access.",
        actionHref: "/platform/ai/providers/openai",
      }),
    ]);
    expect(loadProviderHealth).toHaveBeenCalledTimes(1);
    expect(loadProviderHealth).toHaveBeenCalledWith("openai");
  });
});
