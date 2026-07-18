import { describe, expect, it } from "vitest";

import type { OperationalCapabilityState } from "./operational-state";
import { projectCapabilityServiceHealth } from "./service-health";

function operationalState(
  overrides: Partial<OperationalCapabilityState> = {},
): OperationalCapabilityState {
  return {
    catalogVersion: 1,
    catalogHash: "a".repeat(64),
    capabilityStateVersion: "b".repeat(64),
    persistedCatalogHash: "a".repeat(64),
    persistedStateVersion: "b".repeat(64),
    enabledRuntimeCapabilities: ["runtime:core", "runtime:browser-automation"],
    serviceRequirements: [
      {
        service: "portal",
        capability: "runtime:core",
        backupPolicy: "excluded-stateless",
        healthSemantics: "compose-healthcheck",
        dependsOn: [],
        profiles: [],
        volumes: [],
      },
      {
        service: "browser-use",
        capability: "runtime:browser-automation",
        backupPolicy: "excluded-stateless",
        healthSemantics: "compose-healthcheck",
        dependsOn: ["portal"],
        profiles: ["browser-automation"],
        volumes: [],
      },
    ],
    observedServices: {
      portal: { composePresent: true, healthy: true },
      "browser-use": { composePresent: true, healthy: true },
    },
    backupServices: ["postgres"],
    capabilityBackupCandidates: [],
    capabilityBackupPolicies: {},
    externalRuntimes: [],
    providerState: {},
    serviceStates: { portal: "required", "browser-use": "required" },
    ...overrides,
  };
}

describe("projectCapabilityServiceHealth", () => {
  it.each([
    {
      name: "healthy required service",
      state: operationalState(),
      key: "portal",
      expected: {
        state: "required",
        availability: "available",
        label: "Required — operational",
      },
    },
    {
      name: "missing required service",
      state: operationalState({
        observedServices: {
          "browser-use": { composePresent: true, healthy: true },
        },
      }),
      key: "portal",
      expected: {
        state: "required",
        availability: "unavailable",
        label: "Required — unavailable",
      },
    },
    {
      name: "disabled optional service",
      state: operationalState({
        enabledRuntimeCapabilities: ["runtime:core"],
        serviceRequirements: [operationalState().serviceRequirements[0]!],
        observedServices: { portal: { composePresent: true, healthy: true } },
        serviceStates: {
          portal: "required",
          "browser-use": "optional_inactive",
        },
      }),
      key: "browser-use",
      expected: {
        state: "optional_inactive",
        availability: "inactive",
        label: "Optional — inactive",
      },
    },
    {
      name: "enabled unhealthy optional service",
      state: operationalState({
        observedServices: {
          portal: { composePresent: true, healthy: true },
          "browser-use": { composePresent: true, healthy: false },
        },
        serviceStates: {
          portal: "required",
          "browser-use": "optional_degraded",
        },
      }),
      key: "browser-use",
      expected: {
        state: "optional_degraded",
        availability: "unavailable",
        label: "Optional — degraded",
      },
    },
    {
      name: "configured external runtime",
      state: operationalState({
        externalRuntimes: [
          {
            runtimeKey: "openai",
            healthSemantics: "provider-health-reconciliation",
          },
        ],
        providerState: { openai: { configured: true, healthy: true } },
      }),
      key: "openai",
      expected: {
        state: "external",
        availability: "available",
        label: "External — provider managed",
      },
    },
  ])("projects $name with a non-color label and action", ({ state, key, expected }) => {
    const result = projectCapabilityServiceHealth(state);
    const item = result.items.find((candidate) => candidate.key === key);

    expect(item).toMatchObject(expected);
    expect(item?.action).toEqual(expect.any(String));
    expect(item?.action.length).toBeGreaterThan(0);
  });

  it("degrades aggregate health for missing required and degraded optional services", () => {
    const missingRequired = projectCapabilityServiceHealth(
      operationalState({
        observedServices: {
          "browser-use": { composePresent: true, healthy: true },
        },
      }),
    );
    expect(missingRequired.aggregate).toMatchObject({
      value: "Degraded",
      tone: "warning",
    });
    expect(missingRequired.aggregate.detail).toContain("portal");

    const degradedOptional = projectCapabilityServiceHealth(
      operationalState({
        observedServices: {
          portal: { composePresent: true, healthy: true },
          "browser-use": { composePresent: false, healthy: null },
        },
        serviceStates: {
          portal: "required",
          "browser-use": "optional_degraded",
        },
      }),
    );
    expect(degradedOptional.aggregate.value).toBe("Degraded");
    expect(degradedOptional.aggregate.detail).toContain("browser-use");
  });

  it("degrades aggregate health when a required service reports unhealthy", () => {
    const result = projectCapabilityServiceHealth(
      operationalState({
        observedServices: {
          portal: { composePresent: true, healthy: false },
          "browser-use": { composePresent: true, healthy: true },
        },
      }),
    );

    expect(result.aggregate).toMatchObject({ value: "Degraded", tone: "warning" });
    expect(result.aggregate.detail).toContain("portal");
  });

  it("keeps aggregate health operational when an optional service is intentionally inactive", () => {
    const result = projectCapabilityServiceHealth(
      operationalState({
        enabledRuntimeCapabilities: ["runtime:core"],
        serviceRequirements: [operationalState().serviceRequirements[0]!],
        observedServices: { portal: { composePresent: true, healthy: true } },
        serviceStates: {
          portal: "required",
          "browser-use": "optional_inactive",
        },
      }),
    );

    expect(result.aggregate).toEqual({
      value: "Operational",
      tone: "success",
      detail: "Required platform services are available",
    });
  });

  it("omits unconfigured provider choices and projects configured providers as external", () => {
    const result = projectCapabilityServiceHealth(
      operationalState({
        externalRuntimes: [
          { runtimeKey: "openai", healthSemantics: "provider-health-reconciliation" },
          { runtimeKey: "anthropic", healthSemantics: "provider-health-reconciliation" },
        ],
        providerState: {
          openai: { configured: true, healthy: true },
          anthropic: { configured: false, healthy: null },
        },
      }),
    );

    expect(result.items.filter((item) => item.state === "external").map((item) => item.key)).toEqual([
      "openai",
    ]);
  });

  it("does not present a configured provider with no recent signal as available", () => {
    const result = projectCapabilityServiceHealth(
      operationalState({
        externalRuntimes: [
          { runtimeKey: "openai", healthSemantics: "provider-health-reconciliation" },
        ],
        providerState: {
          openai: {
            configured: true,
            healthy: null,
            detail: "No recent activity. Health will update after the next request.",
          },
        },
      }),
    );

    expect(result.items.at(-1)).toMatchObject({
      key: "openai",
      label: "External — provider managed",
      availability: "unknown",
      detail: "No recent activity. Health will update after the next request.",
      action: "Run a request to establish current provider health.",
    });
  });

  it("projects reconciled provider failure without treating lifecycle as health", () => {
    const result = projectCapabilityServiceHealth(
      operationalState({
        externalRuntimes: [
          { runtimeKey: "openai", healthSemantics: "provider-health-reconciliation" },
        ],
        providerState: {
          openai: {
            configured: true,
            healthy: false,
            detail: "Recent requests are failing. Check this provider's settings.",
            actionHref: "/platform/ai/providers/openai",
          },
        },
      }),
    );

    expect(result.items.at(-1)).toMatchObject({
      key: "openai",
      label: "External — provider managed",
      availability: "unavailable",
      detail: "Recent requests are failing. Check this provider's settings.",
      action: "Open provider settings to restore availability.",
      actionHref: "/platform/ai/providers/openai",
    });
  });

  it.each([
    {
      name: "service observation",
      state: operationalState({
        observedServices: {
          portal: { composePresent: true, healthy: true },
          "browser-use": { composePresent: true, healthy: true },
          qdrant: { composePresent: true, healthy: true },
        },
      }),
      error: "unknown_service_observation:qdrant",
    },
    {
      name: "provider observation",
      state: operationalState({
        providerState: { mystery: { configured: true, healthy: true } },
      }),
      error: "unknown_provider_observation:mystery",
    },
  ])("rejects a $name absent from the catalog projection", ({ state, error }) => {
    expect(() => projectCapabilityServiceHealth(state)).toThrow(error);
  });
});
