// BI-8BBFE50B (slice D5 of BI-83260BB3): what the monitoring switch shows.
//
// Pure. The settings page must report monitoring from OBSERVATION, not only the
// capability row: "on" means install-state enables runtime:deep-observability
// AND prometheus, grafana and postgres-exporter are observed running. Any other
// mix is named rather than hidden (design 2026-10-13 monitoring operator choice
// §6). The switch requests a reconciliation-mode change (BI-F0C2E8F5), so a
// monitoring record that disagrees with install-state no longer locks it: the
// status follows the host and the button offers to match the record to what is
// running. The lock remains only when reconciliation itself cannot run — the
// records are incomplete or install-state belongs to another catalog.
//
// `reason` is an `admin` catalog key, not prose, so the page can localize it.

import type { MessageKey } from "@dpf/i18n";

export const MONITORING_CAPABILITY = "runtime:deep-observability";
export const MONITORING_SERVICES = ["prometheus", "grafana", "postgres-exporter"] as const;

export type MonitoringStatus = "on" | "off" | "turning-on" | "turning-off" | "needs-attention" | "unreconciled";

export interface MonitoringDecisionRecord {
  decision: string;
  source: string | null;
  decidedAt: string | null;
}

export interface MonitoringSwitchInput {
  /** install-state `enabledRuntimeCapabilities`, or null when unreadable. */
  installEnabled: string[] | null;
  /** `PlatformCapability.state` for runtime:deep-observability, or null when unknown. */
  dbState: string | null;
  observed: Record<string, { composePresent: boolean; healthy: boolean | null }>;
  decision: MonitoringDecisionRecord | null;
  /** The records cannot be reconciled: a catalog capability has no record, or
   * install-state was written for a different capability catalog. */
  unreconcilable: boolean;
  pendingTransition?: "enabling" | "disabling" | null;
}

export interface MonitoringSwitchState {
  status: MonitoringStatus;
  canToggle: boolean;
  reason: MessageKey<"admin"> | null;
  undecided: boolean;
  /** Enabled: services absent or unhealthy. Disabled: services still present. */
  missingServices: string[];
  /** The monitoring record disagrees with install-state; the action matches it. */
  recordMismatch: boolean;
}

export function deriveMonitoringSwitchState(input: MonitoringSwitchInput): MonitoringSwitchState {
  const undecided = input.decision === null || input.decision.decision === "undecided";
  const base = { undecided, missingServices: [] as string[], recordMismatch: false };

  if (input.pendingTransition) {
    return {
      ...base,
      status: input.pendingTransition === "enabling" ? "turning-on" : "turning-off",
      canToggle: false,
      reason: "monitoringSettings.reason.inFlight",
    };
  }
  if (input.installEnabled === null) {
    return { ...base, status: "needs-attention", canToggle: false, reason: "monitoringSettings.reason.installUnknown" };
  }

  if (input.unreconcilable) {
    return { ...base, status: "unreconciled", canToggle: false, reason: "monitoringSettings.reason.unreconciled" };
  }

  const enabled = input.installEnabled.includes(MONITORING_CAPABILITY);
  base.recordMismatch = (input.dbState === "active" && !enabled) || (input.dbState === "disabled" && enabled);

  if (enabled) {
    const missing = MONITORING_SERVICES.filter((service) => {
      const observed = input.observed[service];
      return !observed?.composePresent || observed.healthy === false;
    });
    if (missing.length === 0) return { ...base, status: "on", canToggle: true, reason: null };
    return { ...base, status: "needs-attention", canToggle: true, reason: "monitoringSettings.reason.enabledMissing", missingServices: [...missing] };
  }

  const running = MONITORING_SERVICES.filter((service) => input.observed[service]?.composePresent);
  if (running.length === 0) return { ...base, status: "off", canToggle: true, reason: null };
  return { ...base, status: "needs-attention", canToggle: true, reason: "monitoringSettings.reason.disabledRunning", missingServices: [...running] };
}
