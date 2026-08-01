// Pure utility library — no server imports. Safe in tests and client components.
//
// Single source of truth for the closed set of models that may participate in the
// unified lifecycle backbone (LifecycleEvent / PlateauMembership / LifecycleGap).
// Spec: docs/superpowers/specs/2026-06-07-unified-lifecycle-backbone-design.md §8.2.
//
// A "governed thing" is any entity that carries lifecycle, ownership, accountability,
// policy, control, obligation, authorization, or audit semantics (CSDM6 metamodel).
// Lifecycle event/membership/gap rows reference governed things polymorphically as
// (kind, id). This allowlist prevents arbitrary (kind, id) pairs from entering those
// rows — the resolver and persistence layers validate against it.
//
// Adding a kind requires: (1) add the value here, (2) add its mapping in
// resolveLifecycle() in lib/lifecycle.ts, (3) add a row-shape mapper there — all in
// the same commit (single-source-of-truth, AGENTS.md §3).

export const GOVERNED_THING_KINDS = [
  "EaElement",
  "DigitalProduct",
  "InventoryEntity",
  "ServiceOffering",
  "Document",
  "Agent",
  "BusinessCapability",
] as const;
export type GovernedThingKind = (typeof GOVERNED_THING_KINDS)[number];

export type GovernedThingRef = {
  kind: GovernedThingKind;
  id: string;
};

const GOVERNED_THING_KIND_SET: ReadonlySet<string> = new Set(GOVERNED_THING_KINDS);

/** Type guard — narrows an arbitrary string to GovernedThingKind. */
export function isGovernedThingKind(value: unknown): value is GovernedThingKind {
  return typeof value === "string" && GOVERNED_THING_KIND_SET.has(value);
}

/**
 * Validate and construct a GovernedThingRef. Returns null when the kind is not in
 * the allowlist or the id is empty — callers must reject null rather than persist a
 * dangling reference.
 */
export function parseGovernedThingRef(kind: unknown, id: unknown): GovernedThingRef | null {
  if (!isGovernedThingKind(kind)) return null;
  if (typeof id !== "string") return null;
  const trimmed = id.trim();
  if (!trimmed) return null;
  return { kind, id: trimmed };
}

/** Stable composite key for dedup/index use, e.g. "EaElement:clx123". */
export function governedThingRefKey(ref: GovernedThingRef): string {
  return `${ref.kind}:${ref.id}`;
}

/** Parse a composite key produced by governedThingRefKey back into a ref. */
export function parseGovernedThingRefKey(key: string): GovernedThingRef | null {
  const idx = key.indexOf(":");
  if (idx <= 0) return null;
  return parseGovernedThingRef(key.slice(0, idx), key.slice(idx + 1));
}
