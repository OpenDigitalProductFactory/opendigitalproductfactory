// BI-F0C2E8F5: the monitoring switch asks for a RECONCILIATION-mode change.
//
// A normal-mode transition takes its previous keys from the database's active
// rows, so on an install whose PlatformCapability rows disagree with
// install-state the host apply refuses it as `install_state_stale`. A
// reconciliation intent instead names both observed baselines (host and
// database) and the one key it changes, so the host stays authoritative for
// what runs and every other record is carried exactly as observed. Residual
// drift on other keys is preserved, never silently corrected.
//
// Pure. The result is validated again by the shared host contract
// (`prepareRuntimeReconciliationIntent`) in the executor and the actuator.

import { MONITORING_CAPABILITY } from "./monitoring-switch-state";
import type { RuntimeReconciliationIntent } from "./transition-protocol";

export interface MonitoringReconciliationPreview {
  observedHost: RuntimeReconciliationIntent["observedHost"];
  observedDatabaseStates: Readonly<Record<string, string>>;
  capabilities: ReadonlyArray<{ capabilityId: string; dependencies: readonly string[] }>;
}

export interface MonitoringReconciliationRequest {
  /** Equals `reconciliation.desiredHostEnabledKeys`; the executor checks it. */
  desiredKeys: string[];
  reconciliation: RuntimeReconciliationIntent;
}

export function buildMonitoringReconciliationIntent(preview: MonitoringReconciliationPreview, turnOn: boolean): MonitoringReconciliationRequest {
  const dependencies = new Map(preview.capabilities.map((entry) => [entry.capabilityId, entry.dependencies]));
  const enabled = new Set(preview.observedHost.enabledRuntimeCapabilities);

  if (turnOn) {
    const add = (id: string) => {
      if (enabled.has(id)) return;
      const deps = dependencies.get(id);
      if (!deps) throw new Error(`unknown_runtime_capability:${id}`);
      enabled.add(id);
      deps.forEach(add);
    };
    enabled.delete(MONITORING_CAPABILITY);
    add(MONITORING_CAPABILITY);
  } else {
    enabled.delete(MONITORING_CAPABILITY);
    // Removing a key another enabled capability needs would break the closure
    // the host verifies; refuse rather than silently disabling dependents.
    const dependsOnMonitoring = (id: string, seen = new Set<string>()): boolean => {
      if (seen.has(id)) return false;
      seen.add(id);
      return (dependencies.get(id) ?? []).some((dep) => dep === MONITORING_CAPABILITY || dependsOnMonitoring(dep, seen));
    };
    if ([...enabled].some((id) => dependsOnMonitoring(id))) throw new Error("monitoring_has_dependents");
  }

  const desiredHostEnabledKeys = [...enabled].sort();
  return {
    desiredKeys: [...desiredHostEnabledKeys],
    reconciliation: {
      observedHost: { ...structuredClone(preview.observedHost), enabledRuntimeCapabilities: [...preview.observedHost.enabledRuntimeCapabilities] },
      observedDatabaseStates: { ...preview.observedDatabaseStates },
      desiredHostEnabledKeys,
      desiredDatabaseStates: { ...preview.observedDatabaseStates, [MONITORING_CAPABILITY]: turnOn ? "active" : "disabled" },
      touchedKeys: [MONITORING_CAPABILITY],
    },
  };
}
