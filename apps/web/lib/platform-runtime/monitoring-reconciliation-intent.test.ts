import { describe, expect, it } from "vitest";

import catalogSeed from "../../../../scripts/capability-service-catalog.generated.json";
import { computeCapabilityStateVersion } from "../../../../scripts/lib/capability-state-hash.mjs";
import { prepareRuntimeReconciliationIntent } from "../../../../scripts/lib/transition-signing.mjs";

import { buildMonitoringReconciliationIntent, type MonitoringReconciliationPreview } from "./monitoring-reconciliation-intent";

const catalog = catalogSeed as { catalogHash: string; capabilities: Array<{ capabilityId: string; dependencies: string[] }> };
const ids = catalog.capabilities.map((entry) => entry.capabilityId);
const MONITORING = "runtime:deep-observability";

function preview(hostKeys: string[], dbActive: string[]): MonitoringReconciliationPreview {
  const enabled = [...hostKeys].sort();
  return {
    observedHost: {
      schemaVersion: 2, installerVersion: "fixture", platform: "linux", arch: "amd64",
      capabilityCatalogHash: catalog.catalogHash,
      capabilityStateVersion: computeCapabilityStateVersion(catalog.catalogHash, enabled, ids),
      enabledRuntimeCapabilities: enabled,
    },
    observedDatabaseStates: Object.fromEntries(ids.map((id) => [id, dbActive.includes(id) ? "active" : "disabled"])),
    capabilities: catalog.capabilities.map((entry) => ({ capabilityId: entry.capabilityId, dependencies: entry.dependencies })),
  };
}

/** The live drift: install-state enables only core; the database has monitoring and other seeded rows active. */
const drifted = () => preview(["runtime:core"], ["runtime:core", MONITORING, "runtime:build", "runtime:external-ai"]);

function acceptedByHostContract(intent: ReturnType<typeof buildMonitoringReconciliationIntent>) {
  return prepareRuntimeReconciliationIntent(intent.reconciliation, { catalogHash: catalog.catalogHash, capabilityIds: ids });
}

describe("buildMonitoringReconciliationIntent", () => {
  it("turning off on a drifted install leaves the host alone and disables only the monitoring record", () => {
    const source = drifted();
    const intent = buildMonitoringReconciliationIntent(source, false);
    expect(intent.desiredKeys).toEqual(["runtime:core"]);
    expect(intent.reconciliation.desiredHostEnabledKeys).toEqual(["runtime:core"]);
    expect(intent.reconciliation.touchedKeys).toEqual([MONITORING]);
    expect(intent.reconciliation.desiredDatabaseStates).toEqual({ ...source.observedDatabaseStates, [MONITORING]: "disabled" });
    expect(intent.reconciliation.observedHost).toEqual(source.observedHost);
    expect(intent.reconciliation.observedDatabaseStates).toEqual(source.observedDatabaseStates);
    const prepared = acceptedByHostContract(intent);
    // Other drifted rows are preserved, never silently corrected.
    expect(prepared.residualDriftKeys).toEqual(["runtime:build", "runtime:external-ai"]);
  });

  it("turning on on a drifted install adds the key to the host and keeps the record active", () => {
    const source = drifted();
    const intent = buildMonitoringReconciliationIntent(source, true);
    expect(intent.desiredKeys).toEqual(["runtime:core", MONITORING]);
    expect(intent.reconciliation.desiredHostEnabledKeys).toEqual(["runtime:core", MONITORING]);
    expect(intent.reconciliation.desiredDatabaseStates).toEqual({ ...source.observedDatabaseStates, [MONITORING]: "active" });
    expect(intent.reconciliation.touchedKeys).toEqual([MONITORING]);
    expect(acceptedByHostContract(intent).residualDriftKeys).toEqual(["runtime:build", "runtime:external-ai"]);
  });

  it("turns monitoring on and off on a clean install with no residual drift", () => {
    const off = preview(["runtime:core"], ["runtime:core"]);
    const on = buildMonitoringReconciliationIntent(off, true);
    expect(on.desiredKeys).toEqual(["runtime:core", MONITORING]);
    expect(on.reconciliation.desiredDatabaseStates).toEqual({ ...off.observedDatabaseStates, [MONITORING]: "active" });
    expect(acceptedByHostContract(on).residualDriftKeys).toEqual([]);

    const running = preview(["runtime:core", MONITORING], ["runtime:core", MONITORING]);
    const offAgain = buildMonitoringReconciliationIntent(running, false);
    expect(offAgain.desiredKeys).toEqual(["runtime:core"]);
    expect(offAgain.reconciliation.desiredDatabaseStates).toEqual({ ...running.observedDatabaseStates, [MONITORING]: "disabled" });
    expect(acceptedByHostContract(offAgain).residualDriftKeys).toEqual([]);
  });

  it("adds the monitoring dependency closure when turning on", () => {
    const source = preview(["runtime:core"], ["runtime:core"]);
    source.capabilities = source.capabilities.map((entry) => entry.capabilityId === MONITORING
      ? { ...entry, dependencies: ["runtime:core", "runtime:build"] } : entry);
    expect(buildMonitoringReconciliationIntent(source, true).desiredKeys).toEqual(["runtime:build", "runtime:core", MONITORING]);
  });

  it("refuses to turn off monitoring while an enabled capability depends on it", () => {
    const source = preview(["runtime:core", MONITORING, "runtime:build"], ["runtime:core", MONITORING, "runtime:build"]);
    source.capabilities = source.capabilities.map((entry) => entry.capabilityId === "runtime:build"
      ? { ...entry, dependencies: ["runtime:core", MONITORING] } : entry);
    expect(() => buildMonitoringReconciliationIntent(source, false)).toThrow("monitoring_has_dependents");
  });

  it("does not mutate the preview", () => {
    const source = drifted();
    const snapshot = structuredClone(source);
    buildMonitoringReconciliationIntent(source, true);
    expect(source).toEqual(snapshot);
  });
});
