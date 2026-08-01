// PATCH-semantics helper for partial workforce updates (BI-HCM-004).
//
// Lives outside `lib/actions/workforce.ts` because that module is `"use server"` and may only
// export async functions — a sync helper cannot be exported from it for testing.

/** Trim to a value, or null when blank/absent. */
export function trimToNull(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Resolve one optional field under PATCH semantics.
 *
 *   absent key   -> keep `current` (the caller is not talking about this field)
 *   null or ""   -> clear it (an explicit, deliberate unset)
 *   value        -> set it
 *
 * Distinguishing "absent" from "empty" is the entire point. Collapsing both to null — which
 * is what a plain `trimToNull(input.field)` does — turns every partial update into a silent
 * wipe of the fields it never mentioned. `assignEmployeeOrg` had exactly that shape, which is
 * why the org chart had to route around it rather than reuse it.
 */
export function patchOptional<K extends string>(
  input: Partial<Record<K, string | null>>,
  key: K,
  current: string | null,
): string | null {
  if (!(key in input) || input[key] === undefined) return current;
  return trimToNull(input[key]);
}
