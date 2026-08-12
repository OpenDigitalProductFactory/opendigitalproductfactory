// EP-DELIVERY-FLOW · BI-67315C4A increment 6 — version-vector causal ordering.
//
// Kernel-decided over CRDT (DI-1BC547243903) as the federated-demand conflict model.
// A version vector is a per-installation counter map. It gives causal ordering for
// updates and status/closure changes that can originate from different points in a
// customer→reseller→hub chain: two vectors compare by one-sided dominance (a clean
// newer-than) or reveal a genuine CONCURRENT edit that must surface as a conflict
// rather than be silently lost (the failure mode a wall-clock scalar hides).
//
// Supersedes the ms-epoch scalar (interim BigInt fix #4092) for conflict detection;
// the scalar remains only as a coarse back-compat ordering hint during migration.
//
// Pure and dependency-free — exhaustively unit-testable. Wiring it onto the demand
// envelope + FederatedRecordMirror (schema + exchange) is the following increment.

/** installationId → monotonic counter. Missing key ≡ 0. */
export type VersionVector = Record<string, number>;

export type VectorOrder = "equal" | "dominates" | "dominated" | "concurrent";

/** True for a well-formed version vector (non-negative safe-integer counters). */
export function isVersionVector(value: unknown): value is VersionVector {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value as Record<string, unknown>).every(
    ([k, v]) =>
      k.length > 0 &&
      typeof v === "number" &&
      Number.isSafeInteger(v) &&
      v >= 0,
  );
}

function keysOf(a: VersionVector, b: VersionVector): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])];
}

/** Compare two version vectors:
 *  - `equal`      — identical causal history.
 *  - `dominates`  — `a` is strictly newer (every entry ≥ b, at least one >).
 *  - `dominated`  — `b` is strictly newer.
 *  - `concurrent` — each has an entry the other lacks/exceeds → a real conflict. */
export function compareVersionVectors(a: VersionVector, b: VersionVector): VectorOrder {
  let aAhead = false;
  let bAhead = false;
  for (const k of keysOf(a, b)) {
    const av = a[k] ?? 0;
    const bv = b[k] ?? 0;
    if (av > bv) aAhead = true;
    else if (bv > av) bAhead = true;
    if (aAhead && bAhead) return "concurrent";
  }
  if (aAhead) return "dominates";
  if (bAhead) return "dominated";
  return "equal";
}

/** True when `a` is at least as new as `b` in every dimension (equal or dominates).
 *  The safe "accept without conflict" predicate for an incoming update. */
export function dominatesOrEqual(a: VersionVector, b: VersionVector): boolean {
  const order = compareVersionVectors(a, b);
  return order === "dominates" || order === "equal";
}

/** Entrywise max — the least upper bound after reconciling a concurrent conflict. */
export function mergeVersionVectors(a: VersionVector, b: VersionVector): VersionVector {
  const merged: VersionVector = {};
  for (const k of keysOf(a, b)) merged[k] = Math.max(a[k] ?? 0, b[k] ?? 0);
  return merged;
}

/** Return a NEW vector with this installation's counter advanced by one. Called
 *  whenever the local install authors a change (create / update / close). */
export function incrementVersionVector(
  vector: VersionVector,
  installationId: string,
): VersionVector {
  if (!installationId) throw new Error("installationId is required to advance a version vector");
  const current = vector[installationId] ?? 0;
  if (current >= Number.MAX_SAFE_INTEGER) throw new Error("version vector counter exhausted");
  return { ...vector, [installationId]: current + 1 };
}
