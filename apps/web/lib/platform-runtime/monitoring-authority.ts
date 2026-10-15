// Whether this install has monitoring (Prometheus, Grafana, postgres-exporter)
// switched on, so metric surfaces can tell "off by choice" from "broken"
// (BI-2CE9CBF4; design 2026-10-13-monitoring-operator-choice-design.md §7).
//
// Install state decides which compose profiles run, so it is the authority for
// "off". A running prometheus container overrides it: whatever the record says,
// metrics are being collected. An unreadable install state is "unknown", never
// "off" — callers then fall back to probing Prometheus.
import { readFile } from "node:fs/promises";

import { observeDockerProjectServices, type ObservedServiceState } from "./operational-state";

export type MonitoringAuthority = "on" | "off" | "unknown";

const MONITORING_CAPABILITY = "runtime:deep-observability";
const CACHE_MS = 15_000;

export function decideMonitoringAuthority(
  installSnapshot: { enabledRuntimeCapabilities?: unknown } | null,
  observedServices: Record<string, ObservedServiceState>,
): MonitoringAuthority {
  if (observedServices.prometheus?.composePresent) return "on";
  const enabled = installSnapshot?.enabledRuntimeCapabilities;
  if (!Array.isArray(enabled)) return "unknown";
  return enabled.includes(MONITORING_CAPABILITY) ? "on" : "off";
}

export async function readMonitoringAuthority(deps: {
  readInstallSnapshot?: () => Promise<{ enabledRuntimeCapabilities?: unknown }>;
  readObservedServices?: () => Promise<Record<string, ObservedServiceState>>;
} = {}): Promise<MonitoringAuthority> {
  const readInstallSnapshot = deps.readInstallSnapshot ?? (async () =>
    JSON.parse(await readFile("/dpf-state/install-state.json", "utf8")) as { enabledRuntimeCapabilities?: unknown });
  const readObservedServices = deps.readObservedServices ?? (() => observeDockerProjectServices());
  const [snapshot, observed] = await Promise.all([
    readInstallSnapshot().catch(() => null),
    readObservedServices().catch(() => ({})),
  ]);
  return decideMonitoringAuthority(snapshot, observed);
}

let cached: { at: number; value: MonitoringAuthority } | null = null;

/** readMonitoringAuthority with a short cache, for request paths polled every few seconds. */
export async function getMonitoringAuthority(now: number = Date.now()): Promise<MonitoringAuthority> {
  if (cached && now - cached.at < CACHE_MS) return cached.value;
  const value = await readMonitoringAuthority();
  cached = { at: now, value };
  return value;
}
