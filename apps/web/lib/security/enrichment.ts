// EP-SOVEREIGN-SOC P0 — enrichment hook (asset / identity / threat-intel).
//
// Spec: docs/superpowers/specs/2026-06-24-sovereign-soc-siem-design.md §4.2, §7.1.
//
// Enrichment attaches asset context (InventoryEntity / CustomerConfigurationItem),
// identity context, and threat-intel IOC matches to a normalized event. The
// lookups are INJECTED so the shape is pure and testable now; the real
// platform-coupled lookups (asset graph, ThreatIndicator store) land with the
// detection engine in P1. With no lookups this is a no-op that still returns the
// empty envelope, so callers merge unconditionally.

import type { NormalizedSecurityCore } from "./normalizers";

export interface AssetContext {
  inventoryEntityId?: string;
  name?: string;
  criticality?: string;
}

export interface IndicatorMatch {
  indicatorType: string;
  value: string;
  source: string;
  severity?: string;
}

export interface SecurityEnrichment {
  asset?: AssetContext;
  indicators: IndicatorMatch[];
}

export interface EnrichmentLookups {
  /** Resolve asset context for a host/device key (InventoryEntity in P1). */
  lookupAsset?: (deviceKey: string) => Promise<AssetContext | null>;
  /** Match observable values against the threat-intel store (ThreatIndicator in P1). */
  matchIndicators?: (values: string[]) => Promise<IndicatorMatch[]>;
}

/** Extract observable string values worth checking against threat intel. */
export function observableValues(core: NormalizedSecurityCore): string[] {
  const obs = core.observables ?? [];
  const values: string[] = [];
  for (const o of obs) {
    const v = (o as { value?: unknown }).value;
    if (typeof v === "string" && v.length) values.push(v);
  }
  return values;
}

function deviceKeyOf(core: NormalizedSecurityCore): string | undefined {
  const dev = core.device as { hostname?: unknown } | undefined;
  return dev && typeof dev.hostname === "string" ? dev.hostname : undefined;
}

/**
 * Enrich a normalized core with asset + threat-intel context. Pure of platform
 * coupling — the caller injects the lookups.
 */
export async function enrichSecurityEvent(
  core: NormalizedSecurityCore,
  lookups: EnrichmentLookups = {},
): Promise<SecurityEnrichment> {
  const deviceKey = deviceKeyOf(core);
  const [asset, indicators] = await Promise.all([
    deviceKey && lookups.lookupAsset
      ? lookups.lookupAsset(deviceKey)
      : Promise.resolve(null),
    lookups.matchIndicators
      ? lookups.matchIndicators(observableValues(core))
      : Promise.resolve([]),
  ]);
  return { asset: asset ?? undefined, indicators: indicators ?? [] };
}
