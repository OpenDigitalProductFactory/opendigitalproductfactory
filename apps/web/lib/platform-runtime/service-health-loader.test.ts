import { describe, expect, it, vi } from "vitest";

import type { OperationalCapabilityState } from "./operational-state";
import { loadCapabilityServiceHealth } from "./service-health-loader";

const operational = {
  catalogVersion: 1,
  catalogHash: "0".repeat(64),
  capabilityStateVersion: "0".repeat(64),
  persistedCatalogHash: null,
  persistedStateVersion: null,
  enabledRuntimeCapabilities: [],
  serviceRequirements: [],
  serviceStates: {},
  observedServices: {},
  backupServices: [],
  capabilityBackupCandidates: [],
  capabilityBackupPolicies: {},
  externalRuntimes: [
    { capability: "runtime:external-ai", runtimeKey: "openai", healthSemantics: "provider-api" },
  ],
  providerState: {},
} satisfies OperationalCapabilityState;

describe("loadCapabilityServiceHealth", () => {
  it("joins catalog-owned providers to reconciled provider health", async () => {
    const loadProviderHealthBatch = vi.fn().mockResolvedValue(new Map([["openai", {
      status: "fulfilled",
      value: {
        status: "degraded",
        remediationKind: "provider_settings",
        safeSummary: "Recent requests are failing. Check this provider's settings.",
        adminActionHref: "/platform/ai/providers/openai",
      },
    }]]));
    const result = await loadCapabilityServiceHealth({
      loadOperationalState: vi.fn().mockResolvedValue(operational),
      loadProviderHealthBatch,
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
    expect(loadProviderHealthBatch).toHaveBeenCalledTimes(1);
    expect(loadProviderHealthBatch).toHaveBeenCalledWith(["openai"]);
  });

  it("preserves no-recent-signal provider health as unknown", async () => {
    const result = await loadCapabilityServiceHealth({
      loadOperationalState: vi.fn().mockResolvedValue(operational),
      loadProviderHealthBatch: vi.fn().mockResolvedValue(new Map([["openai", {
        status: "fulfilled",
        value: {
          status: "unknown",
          remediationKind: "none",
          safeSummary: "No recent activity. Health will update after the next request.",
        },
      }]])),
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
    const loadProviderHealthBatch = vi.fn().mockResolvedValue(new Map([
      ["openai", {
        status: "fulfilled" as const,
        value: {
          status: "needs_reauth" as const,
          remediationKind: "reauth" as const,
          safeSummary: "Needs re-authentication. Reconnect this provider to restore access.",
          adminActionHref: "/platform/ai/providers/openai",
        },
      }],
      ["anthropic", {
        status: "fulfilled" as const,
        value: { status: "unconfigured" as const, remediationKind: "provider_settings" as const, safeSummary: "Not connected." },
      }],
      ["gemini", {
        status: "fulfilled" as const,
        value: { status: "unconfigured" as const, remediationKind: "provider_settings" as const, safeSummary: "Not connected." },
      }],
    ]));
    const result = await loadCapabilityServiceHealth({
      loadOperationalState: vi.fn().mockResolvedValue({
        ...operational,
        externalRuntimes: [
          ...operational.externalRuntimes,
          { capability: "runtime:external-ai", runtimeKey: "anthropic", healthSemantics: "provider-api" },
          { capability: "runtime:external-ai", runtimeKey: "gemini", healthSemantics: "provider-api" },
        ],
      }),
      loadProviderHealthBatch,
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
    expect(result.items).toHaveLength(1);
    expect(loadProviderHealthBatch).toHaveBeenCalledWith(["anthropic", "gemini", "openai"]);
  });

  it("keeps services and other providers visible when one provider reconciliation fails", async () => {
    const result = await loadCapabilityServiceHealth({
      loadOperationalState: vi.fn().mockResolvedValue({
        ...operational,
        serviceRequirements: [{
          service: "portal",
          capability: "runtime:core",
          backupPolicy: "included",
          healthSemantics: "http",
          dependsOn: [],
          profiles: [],
          volumes: [],
        }],
        serviceStates: { portal: "required" },
        observedServices: { portal: { composePresent: true, healthy: true } },
        externalRuntimes: [
          ...operational.externalRuntimes,
          { capability: "runtime:external-ai", runtimeKey: "anthropic", healthSemantics: "provider-api" },
        ],
      }),
      loadProviderHealthBatch: vi.fn().mockResolvedValue(new Map([
        ["openai", { status: "rejected", configured: true }],
        ["anthropic", {
          status: "fulfilled",
          value: {
            status: "healthy",
            remediationKind: "none",
            safeSummary: "Reachable — recent requests are completing.",
          },
        }],
      ])),
    });

    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "portal", label: "Required — operational" }),
      expect.objectContaining({
        key: "openai",
        availability: "unknown",
        detail: "Provider health evidence is temporarily unavailable.",
      }),
      expect.objectContaining({ key: "anthropic", availability: "available" }),
    ]));
  });

  it("preserves required-service classification when the provider batch read fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await loadCapabilityServiceHealth({
      loadOperationalState: vi.fn().mockResolvedValue({
        ...operational,
        serviceRequirements: [{
          service: "portal",
          capability: "runtime:core",
          backupPolicy: "included",
          healthSemantics: "http",
          dependsOn: [],
          profiles: [],
          volumes: [],
        }],
        serviceStates: { portal: "required" },
        observedServices: { portal: { composePresent: false, healthy: null } },
      }),
      loadProviderHealthBatch: vi.fn().mockRejectedValue(new Error("provider observation unavailable")),
    });

    expect(result.aggregate).toEqual({
      value: "Degraded",
      tone: "warning",
      detail: "portal requires attention",
    });
    expect(result.items).toEqual([
      expect.objectContaining({ key: "portal", label: "Required — unavailable" }),
    ]);
    expect(result.items.some((item) => item.state === "external")).toBe(false);
    expect(log).toHaveBeenCalledWith(
      "[capability-service-health] provider observations unavailable",
      { event: "provider_health_batch_unavailable", providerCount: 1 },
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain("provider observation unavailable");
    log.mockRestore();
  });
});
