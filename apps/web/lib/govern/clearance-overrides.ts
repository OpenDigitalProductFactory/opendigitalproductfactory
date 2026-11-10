// apps/web/lib/govern/clearance-overrides.ts
//
// Break-glass informed-risk clearance overrides (BI-4512E7D2 / BI-BD88A142).
//
// An override is an operator's EXPLICIT, audited acceptance of the risk of
// letting a provider serve a data sensitivity its account is not verified-safe
// for. It is honored by the routing fence (endpointClearsSensitivity) as a
// SEPARATE signal — it never widens ModelProvider.sensitivityClearance, so that
// array keeps meaning "genuinely cleared / safe" and exclusion traces stay
// truthful. Because ModelProvider is install-global, an override is an
// install-level decision (this install accepts the risk for this provider);
// organizationId on the record carries audit attribution (who accepted), not the
// scope of the effect.

import type { SensitivityLevel } from "@/lib/routing/types";

export const RISK_OVERRIDE_STATUS = {
  active: "active",
  revoked: "revoked",
  expired: "expired",
} as const;

// The closed sensitivity scale — source of truth is PRINCIPAL_SENSITIVITIES in
// packages/db/src/principal-sensitivity.ts, plus the routing-only "development"
// class from routing/types.ts. Kept as a local literal on purpose: this module
// sits on the routing hot path, so it must not pull the whole @dpf/db barrel in
// just to validate four stable strings. `SensitivityLevel` (compile-time) still
// governs the shape; a scale change is a migration, so this list changing in
// lockstep is caught by review, not silently drifting.
const KNOWN_LEVELS = new Set<string>([
  "public",
  "internal",
  "confidential",
  "restricted",
  "development",
]);

/** Coerce a stored acceptedSensitivities JSON blob to known sensitivity levels. */
export function parseAcceptedSensitivities(value: unknown): SensitivityLevel[] {
  if (!Array.isArray(value)) return [];
  const out: SensitivityLevel[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && KNOWN_LEVELS.has(entry)) {
      out.push(entry as SensitivityLevel);
    }
  }
  return out;
}

/** An override bites only while active and unexpired. */
export function isRiskOverrideActive(
  row: { status: string; expiresAt: Date },
  nowMs: number,
): boolean {
  return row.status === RISK_OVERRIDE_STATUS.active && row.expiresAt.getTime() > nowMs;
}

/**
 * Map of providerId → the sensitivities an operator has risk-accepted for it,
 * across every active, unexpired override on this install. Empty for every
 * provider unless an operator has explicitly created an override.
 */
export async function loadActiveRiskAcceptedClearances(
  nowMs?: number,
): Promise<Map<string, SensitivityLevel[]>> {
  const at = nowMs ?? Date.now();
  const byProvider = new Map<string, SensitivityLevel[]>();
  try {
    const { prisma } = await import("@dpf/db");
    const rows = await prisma.providerClearanceOverride.findMany({
      where: { status: RISK_OVERRIDE_STATUS.active, expiresAt: { gt: new Date(at) } },
      select: { providerId: true, status: true, expiresAt: true, acceptedSensitivities: true },
    });
    for (const row of rows) {
      // Defense in depth: the query already filters, but re-check the clock so a
      // stale row can never widen clearance.
      if (!isRiskOverrideActive(row, at)) continue;
      const levels = parseAcceptedSensitivities(row.acceptedSensitivities);
      if (levels.length === 0) continue;
      const existing = byProvider.get(row.providerId) ?? [];
      byProvider.set(row.providerId, Array.from(new Set([...existing, ...levels])));
    }
  } catch {
    // A missing table or DB blip must never widen clearance — fail closed to no
    // overrides, exactly as if none existed.
    return new Map();
  }
  return byProvider;
}
