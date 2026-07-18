import { describe, expect, it, vi } from "vitest";

import { createOperationalCapabilityState, loadOperationalCapabilityState, observeDockerProjectServices } from "./operational-state";
import { projectCapabilityServices } from "./capability-service-projection";

describe("createOperationalCapabilityState", () => {
  it.each([{}, { capabilityCatalogHash: "bad", capabilityStateVersion: "bad" }])("rejects missing or invalid install identity", (identity) => {
    expect(() => createOperationalCapabilityState({ installSnapshot: { enabledRuntimeCapabilities: ["runtime:core"], ...identity }, capabilityStates: catalogStates(["runtime:core"]), observedServices: {}, observedProviders: {} })).toThrow(/identity_invalid/);
  });
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
      installSnapshot: snapshot(["runtime:core"]),
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
      installSnapshot: snapshot(["runtime:core"]),
      capabilityStates: catalogStates(["runtime:core"]),
      observedServices: {},
      observedProviders: {},
    });
    expect(inactive.serviceStates["browser-use"]).toBe("optional_inactive");

    const degraded = createOperationalCapabilityState({
      installSnapshot: snapshot(["runtime:browser-automation", "runtime:core"]),
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
      readInstallSnapshot: async () => snapshot(["runtime:core"]),
      readCapabilityStates: async () => catalogStates(["runtime:core"]),
    });
    expect(state.enabledRuntimeCapabilities).toEqual(["runtime:core"]);
  });

  it("loads observations from the host-authority callback when callers do not inject them", async () => {
    const state = await loadOperationalCapabilityState({
      observedProviders: {},
      readInstallSnapshot: async () => snapshot(["runtime:core"]),
      readCapabilityStates: async () => catalogStates(["runtime:core"]),
      readObservedServices: async () => ({ postgres: { composePresent: true, healthy: true } }),
    });
    expect(state.observedServices.postgres.healthy).toBe(true);
  });

  it("defaults to honest missing observations without reading an invented host file", async () => {
    const state = await loadOperationalCapabilityState({
      observedProviders: {}, readInstallSnapshot: async () => snapshot(["runtime:browser-automation", "runtime:core"]),
      readCapabilityStates: async () => catalogStates(["runtime:browser-automation", "runtime:core"]), readObservedServices: async () => ({}),
    });
    expect(state.observedServices).toEqual({});
    expect(state.serviceStates["browser-use"]).toBe("optional_degraded");
  });

  it("observes only the current Compose project through Docker Engine labels", async () => {
    vi.stubEnv("HOSTNAME", "portal-id");
    const observed = await observeDockerProjectServices(async (path) => path.includes("portal-id")
      ? { Config: { Labels: { "com.docker.compose.project": "dpf" } } }
      : [{ State: "running", Status: "Up (healthy)", Labels: { "com.docker.compose.project": "dpf", "com.docker.compose.service": "postgres" } }, { State: "running", Status: "Up (health: starting)", Labels: { "com.docker.compose.project": "dpf", "com.docker.compose.service": "starting" } }, { State: "running", Status: "Up (unhealthy)", Labels: { "com.docker.compose.project": "dpf", "com.docker.compose.service": "unhealthy" } }, { State: "exited", Status: "Exited", Labels: { "com.docker.compose.project": "dpf", "com.docker.compose.service": "browser-use" } }, { State: "running", Labels: { "com.docker.compose.project": "other", "com.docker.compose.service": "postgres" } }]);
    expect(observed).toEqual({ postgres: { composePresent: true, healthy: true }, starting: { composePresent: true, healthy: false }, unhealthy: { composePresent: true, healthy: false }, "browser-use": { composePresent: true, healthy: false } });
  });
});

const CAPABILITIES = ["runtime:adp-integration", "runtime:browser-automation", "runtime:build", "runtime:core", "runtime:deep-observability", "runtime:development", "runtime:durable-automation", "runtime:external-ai", "runtime:local-speech"];
function catalogStates(enabled: string[]) {
  return CAPABILITIES.map((capabilityId) => ({ capabilityId, state: enabled.includes(capabilityId) ? "active" as const : "disabled" as const }));
}
function snapshot(enabled: string[]) {
  const projected = projectCapabilityServices({ enabledRuntimeCapabilities: enabled, capabilityStates: catalogStates(enabled) });
  return { enabledRuntimeCapabilities: enabled, capabilityCatalogHash: projected.catalogHash, capabilityStateVersion: projected.capabilityStateVersion };
}
