// BI-4AA1074B Slice 2: calling-surface → ring-scope resolution.
//
// Spec: docs/superpowers/specs/2026-05-24-founder-kernel-evolution-discipline-design.md §5.1
//
// Each call into `principle_decide` / `recallPrincipleContext` carries a
// `ringScope: PrincipleRingScope[]` declaring which depth(s) of the
// Reduction Gear loop the calling action binds. Wiring layers can pass
// the scope explicitly, OR pass a surface name and let this registry
// resolve the default — mirrors the pattern proposed by the 2026-05-22
// scope-refactor plan's `consumer-context-map.ts`.
//
// Composition: a Ring N→N+1 cross-ring boundary (e.g. GearInterface
// emit) declares BOTH rings via `bothRings(callerRing, outerRing)`.

import {
  PRINCIPLE_RING_SCOPES,
  type PrincipleRingScope,
} from "@dpf/db/wiki-taxonomy";

// ─── Defaults per calling surface ───────────────────────────────────────────

/**
 * Closed registry of named calling surfaces and their default ring scopes.
 *
 * Additions ship via PR review so the discipline stays auditable. A surface
 * with no entry here resolves to `["universal-ring"]` — every kernel call
 * still works, just without ring-scope tightening.
 *
 * The values are derived by walking the Reduction Gear spec §2.2 ring
 * inventory and mapping each existing call site to the ring(s) it binds.
 * Update this table when a new call site is introduced; do not silently
 * fall back to universal-ring just because adding the entry is friction.
 */
export const CALLING_RING_DEFAULTS: Record<string, PrincipleRingScope[]> = {
  // Ring 1 — individual coworker
  "coworker-improvement": ["ring-1-coworker"],
  "tool-call-evaluation": ["ring-1-coworker"],
  "capability-self-assess": ["ring-1-coworker"],

  // Ring 2 — workflow / Build Studio
  "build-studio-phase": ["ring-2-workflow"],
  "build-studio-deliberation": ["ring-2-workflow"],
  "a2a-handoff": ["ring-2-workflow"],
  "phase-gate-decision": ["ring-2-workflow"],

  // Ring 3 — archetype
  "archetype-calibration": ["ring-3-archetype"],
  "archetype-routing": ["ring-3-archetype"],

  // Ring 4 — sandbox/prod
  "promotion-gate": ["ring-4-sandbox-prod"],
  "release-bundle-decision": ["ring-4-sandbox-prod"],
  "runtime-verification": ["ring-4-sandbox-prod"],

  // Ring 5 — hive
  "hive-contribution-gate": ["ring-4-sandbox-prod", "ring-5-hive"],
  "hive-scout-ingest": ["ring-5-hive"],

  // External coordination plane
  "external-supplier-emit": ["external-coordination"],
  "external-partner-emit": ["external-coordination"],
  "external-customer-slice": ["external-coordination"],

  // Universal — design-time / kernel-architecture decisions
  "spec-design-time": ["universal-ring"],
  "kernel-architecture-decision": ["universal-ring"],
};

/**
 * Resolve a calling-surface name to its default ring scope. Unknown
 * surfaces fall back to `["universal-ring"]` (caller didn't constrain;
 * consult the full kernel). The fallback path emits a one-shot debug log
 * the first time each unknown surface appears so missing entries are
 * easy to spot in `[principle-recall-trace]` output — silent fall-through
 * to universal-ring is exactly the default-to-broadest failure mode the
 * ring-scope discipline exists to prevent.
 */
const seenUnknownSurfaces = new Set<string>();

export function resolveCallerRingScope(
  surface: string,
): PrincipleRingScope[] {
  const mapped = CALLING_RING_DEFAULTS[surface];
  if (mapped !== undefined) return mapped;
  if (!seenUnknownSurfaces.has(surface)) {
    seenUnknownSurfaces.add(surface);
    console.debug(
      `[calling-ring-map] unknown surface "${surface}" → universal-ring fallback. ` +
        `Add an entry to CALLING_RING_DEFAULTS in apps/web/lib/wiki/calling-ring-map.ts.`,
    );
  }
  return ["universal-ring"];
}

// ─── Cross-ring composition (GearInterface, dual-emit boundaries) ───────────

/**
 * A Ring-N→N+1 boundary action (e.g. a GearInterface emit at the
 * coworker→workflow seam) binds BOTH rings. Use this helper instead of
 * passing the two scopes as a string literal so typos can't drift apart
 * from the canonical taxonomy.
 *
 * Inner / outer ordering matches the GearInterface schema convention
 * (innerRing is the smaller / faster-spinning ring).
 */
export function bothRings(
  innerRing: PrincipleRingScope,
  outerRing: PrincipleRingScope,
): PrincipleRingScope[] {
  return [innerRing, outerRing];
}

// ─── Predicate used by recall filtering ─────────────────────────────────────

/**
 * Return true when a principle's declared ring scope should surface for
 * a call with the given caller scope.
 *
 * Rules (spec §5.2):
 *   1. Principle tagged `universal-ring` — always passes. Earned scope;
 *      author claimed the rule binds every ring.
 *   2. Principle ring scope is empty — passes. Backward-compat for any
 *      row that hasn't been backfilled yet; the principle's lint will
 *      eventually demand explicit scope.
 *   3. Caller declares `universal-ring` — every principle passes. The
 *      caller did not constrain; consult the full kernel.
 *   4. Otherwise — non-empty intersection of caller and principle scope
 *      is required.
 */
export function principleMatchesRingScope(
  principleScope: readonly string[],
  callerScope: readonly PrincipleRingScope[],
): boolean {
  if (principleScope.length === 0) return true; // backward-compat
  if (principleScope.includes("universal-ring")) return true; // earned universal
  if (callerScope.includes("universal-ring")) return true; // caller open
  for (const c of callerScope) {
    if (principleScope.includes(c)) return true;
  }
  return false;
}

// ─── Re-exports for convenience ─────────────────────────────────────────────

export { PRINCIPLE_RING_SCOPES };
export type { PrincipleRingScope };
