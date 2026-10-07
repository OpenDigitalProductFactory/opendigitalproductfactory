import type { CapabilityServiceHealthProjection } from "./service-health";

/**
 * BI-36DE938C — the Prometheus scrape configs are static: every install
 * scrapes every service a capability *could* run (e.g. `adp:8600`), but a
 * profile-gated service exists only while its runtime capability is active.
 * A down target owned by an inactive capability is an intentional absence,
 * not an outage. The capability projection stays the single authority for
 * which services are expected; this module only joins Prometheus target
 * labels onto it.
 */
export function inactiveCapabilityServices(
  projection: CapabilityServiceHealthProjection | null | undefined,
): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const item of projection?.items ?? []) {
    if (item.kind === "service" && item.availability === "inactive") keys.add(item.key);
  }
  return keys;
}

/**
 * The compose service a scrape target addresses. Targets reach services by
 * their compose DNS name (`adp:8600`, `postgres-exporter:9187`), which is the
 * catalog service key. The job name is not used: jobs and services differ
 * (job `postgres` scrapes service `postgres-exporter`).
 */
export function scrapeTargetService(
  labels: Record<string, string | undefined>,
): string | null {
  const instance = labels.instance;
  if (!instance) return null;
  const colon = instance.lastIndexOf(":");
  const host = colon === -1 ? instance : instance.slice(0, colon);
  return host || null;
}

export function isInactiveCapabilityTarget(
  labels: Record<string, string | undefined>,
  inactiveServices: ReadonlySet<string>,
): boolean {
  const service = scrapeTargetService(labels);
  return service !== null && inactiveServices.has(service);
}
