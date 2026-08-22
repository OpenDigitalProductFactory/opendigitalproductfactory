import type { ScopeClaim } from "@/lib/work-capsules";

/** Edit is exclusive; two read claims may coexist. */
export function intentsConflict(a: ScopeClaim["intent"], b: ScopeClaim["intent"]): boolean {
  return a === "edit" || b === "edit";
}

function normalizePathScope(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/g, "");
}

/** Path ancestors overlap descendants; other scope kinds require exact match. */
export function scopeValuesOverlap(kind: ScopeClaim["kind"], a: string, b: string): boolean {
  if (a === b) return true;
  if (kind !== "path") return false;
  const left = normalizePathScope(a);
  const right = normalizePathScope(b);
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}
