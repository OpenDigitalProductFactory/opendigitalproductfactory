import { describe, expect, it } from "vitest";

import { createOperationalCapabilityState, loadOperationalCapabilityState } from "./operational-state";

describe("createOperationalCapabilityState", () => {
  it("rejects stale persisted catalog identity", () => {
    expect(() => createOperationalCapabilityState({
      installSnapshot: {
        enabledRuntimeCapabilities: ["runtime:core"],
        capabilityCatalogHash: "snapshot-catalog",
        capabilityStateVersion: "snapshot-state",
      },
      capabilityStates: catalogStates(["runtime:core"]),
      observedServices: {},
      observedProviders: {},
    })).toThrow(/install_catalog_stale/);
  });

  it("rejects stale persisted capability state identity", () => {
    expect(() => createOperationalCapabilityState({
      installSnapshot: { enabledRuntimeCapabilities: ["runtime:core"], capabilityStateVersion: "stale" },
      capabilityStates: catalogStates(["runtime:core"]),
      observedServices: {},
      observedProviders: {},
    })).toThrow(/install_capability_state_stale/);
  });

  it("joins persisted enabled state with observations at one typed boundary", () => {
    const state = createOperationalCapabilityState({
      installSnapshot: {
        enabledRuntimeCapabilities: ["runtime:core"],
      },
      capabilityStates: catalogStates(["runtime:core"]),
      observedServices: { postgres: { composePresent: true, healthy: true } },
      observedProviders: { openai: { configured: true, healthy: true } },
    });

    expect(state.catalogVersion).toBe(1);
    expect(state.enabledRuntimeCapabilities).toEqual(["runtime:core"]);
    expect(state.observedServices.postgres).toEqual({ composePresent: true, healthy: true });
    expect(state.providerState.openai).toEqual({ configured: true, healthy: true });
    expect(state.backupServices).toContain("postgres");
  });

  it("classifies disabled and enabled-but-missing optional services", () => {
    const inactive = createOperationalCapabilityState({
      installSnapshot: { enabledRuntimeCapabilities: ["runtime:core"] },
      capabilityStates: catalogStates(["runtime:core"]),
      observedServices: {},
      observedProviders: {},
    });
    expect(inactive.serviceStates["browser-use"]).toBe("optional_inactive");

    const degraded = createOperationalCapabilityState({
      installSnapshot: { enabledRuntimeCapabilities: ["runtime:browser-automation", "runtime:core"] },
      capabilityStates: catalogStates(["runtime:browser-automation", "runtime:core"]),
      observedServices: {},
      observedProviders: {},
    });
    expect(degraded.serviceStates["browser-use"]).toBe("optional_degraded");
  });

  it("loads live capability state and the persisted install snapshot", async () => {
    const state = await loadOperationalCapabilityState({
      observedServices: {},
      observedProviders: {},
      readInstallSnapshot: async () => ({ enabledRuntimeCapabilities: ["runtime:core"] }),
      readCapabilityStates: async () => catalogStates(["runtime:core"]),
    });
    expect(state.enabledRuntimeCapabilities).toEqual(["runtime:core"]);
  });

  it("loads observations from the host-authority callback when callers do not inject them", async () => {
    const state = await loadOperationalCapabilityState({
      observedProviders: {},
      readInstallSnapshot: async () => ({ enabledRuntimeCapabilities: ["runtime:core"] }),
      readCapabilityStates: async () => catalogStates(["runtime:core"]),
      readObservedServices: async () => ({ postgres: { composePresent: true, healthy: true } }),
    });
    expect(state.observedServices.postgres.healthy).toBe(true);
  });

  it("defaults to honest missing observations without reading an invented host file", async () => {
    const state = await loadOperationalCapabilityState({
      observedProviders: {}, readInstallSnapshot: async () => ({ enabledRuntimeCapabilities: ["runtime:browser-automation", "runtime:core"] }),
      readCapabilityStates: async () => catalogStates(["runtime:browser-automation", "runtime:core"]),
    });
    expect(state.observedServices).toEqual({});
    expect(state.serviceStates["browser-use"]).toBe("optional_degraded");
  });
});

const CAPABILITIES = ["runtime:adp-integration", "runtime:browser-automation", "runtime:build", "runtime:core", "runtime:deep-observability", "runtime:development", "runtime:durable-automation", "runtime:external-ai", "runtime:local-speech"];
function catalogStates(enabled: string[]) {
  return CAPABILITIES.map((capabilityId) => ({ capabilityId, state: enabled.includes(capabilityId) ? "active" as const : "disabled" as const }));
}
