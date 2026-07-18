import { describe, expect, it } from "vitest";

import { createOperationalCapabilityState, loadOperationalCapabilityState } from "./operational-state";

describe("createOperationalCapabilityState", () => {
  it("joins persisted enabled state with observations at one typed boundary", () => {
    const state = createOperationalCapabilityState({
      installSnapshot: {
        enabledRuntimeCapabilities: ["runtime:core"],
        capabilityCatalogHash: "snapshot-catalog",
        capabilityStateVersion: "snapshot-state",
      },
      capabilityStates: [{ capabilityId: "runtime:core", state: "active" }],
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
      capabilityStates: [{ capabilityId: "runtime:core", state: "active" }],
      observedServices: {},
      observedProviders: {},
    });
    expect(inactive.serviceStates["browser-use"]).toBe("optional_inactive");

    const degraded = createOperationalCapabilityState({
      installSnapshot: { enabledRuntimeCapabilities: ["runtime:browser-automation", "runtime:core"] },
      capabilityStates: [
        { capabilityId: "runtime:browser-automation", state: "active" },
        { capabilityId: "runtime:core", state: "active" },
      ],
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
      readCapabilityStates: async () => [{ capabilityId: "runtime:core", state: "active" }],
    });
    expect(state.enabledRuntimeCapabilities).toEqual(["runtime:core"]);
  });
});
