// BI-8BBFE50B (slice D5 of BI-83260BB3): what the monitoring switch shows.
//
// Pure. The settings page must report monitoring from OBSERVATION, not only the
// capability row: "on" means install-state enables runtime:deep-observability
// AND prometheus, grafana and postgres-exporter are observed running. Any other
// mix is named rather than hidden (design 2026-10-13 monitoring operator choice
// §6). When the install snapshot and the database disagree, a transition would
// be refused as stale, so the switch locks with an honest reason instead
// (BI-5ACBAC50 owns the reconcile).
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
  /** Install-state vs database disagreement from the divergence diagnosis. */
  divergent: boolean;
  pendingTransition?: "enabling" | "disabling" | null;
}

export interface MonitoringSwitchState {
  status: MonitoringStatus;
  canToggle: boolean;
  reason: MessageKey<"admin"> | null;
  undecided: boolean;
  /** Enabled: services absent or unhealthy. Disabled: services still present. */
  missingServices: string[];
}

export function deriveMonitoringSwitchState(input: MonitoringSwitchInput): MonitoringSwitchState {
  const undecided = input.decision === null || input.decision.decision === "undecided";
  const base = { undecided, missingServices: [] as string[] };

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

  const enabled = input.installEnabled.includes(MONITORING_CAPABILITY);
  const rowDisagrees =
    (input.dbState === "active" && !enabled) || (input.dbState === "disabled" && enabled);
  if (input.divergent || rowDisagrees) {
    return { ...base, status: "unreconciled", canToggle: false, reason: "monitoringSettings.reason.unreconciled" };
  }

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
