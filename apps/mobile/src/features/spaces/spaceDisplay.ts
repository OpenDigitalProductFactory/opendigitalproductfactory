/**
 * Pure helpers backing the SpaceSwitcher UI — no React, no zustand, no I/O.
 * Easier to test, and the switcher component reads identical shape from the
 * existing useSpacesStore. Keeping the projection separate means the
 * ordering rule ("active first, then most-recently-used") has a single
 * unit-tested source of truth.
 */
import type { Space } from "@dpf/types";

export interface SpaceDisplayRow {
  spaceId: string;
  label: string;
  url: string;
  isActive: boolean;
}

export interface OrderSpacesInput {
  spaces: Space[];
  activeSpaceId: string | null;
}

/**
 * Order spaces for the switcher: active first, then by lastUsedAt desc
 * (most-recently-used surfaces faster), with stable insertion-order
 * tiebreak so the list never reshuffles between renders.
 */
export function orderSpacesForSwitcher(
  input: OrderSpacesInput,
): SpaceDisplayRow[] {
  const { spaces, activeSpaceId } = input;
  const indexed = spaces.map((s, i) => ({ s, i }));
  indexed.sort((a, b) => {
    const aActive = a.s.spaceId === activeSpaceId ? 0 : 1;
    const bActive = b.s.spaceId === activeSpaceId ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    const aLast = a.s.lastUsedAt ?? 0;
    const bLast = b.s.lastUsedAt ?? 0;
    if (aLast !== bLast) return bLast - aLast;
    return a.i - b.i;
  });
  return indexed.map(({ s }) => ({
    spaceId: s.spaceId,
    label: s.label,
    url: s.url,
    isActive: s.spaceId === activeSpaceId,
  }));
}
