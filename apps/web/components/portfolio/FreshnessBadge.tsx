// apps/web/components/portfolio/FreshnessBadge.tsx
//
// Small all-caps pill that surfaces an InventoryEntity's freshness state on
// the digital product detail page (Task 3.4 of the discovery -> portfolio
// gap closure plan).
//
// Forward-compatible with Chunk 4 Task 4.1: until the schema gains a
// `freshness` column, callers pass `null` / `undefined` and the badge
// renders an "Unknown" muted state. Once Chunk 4 lands, the same component
// surfaces the real value with no further changes.

import type { ReactElement } from "react";

export type FreshnessProp = "fresh" | "stale" | "retired" | null | undefined;

type Props = {
  freshness: FreshnessProp;
};

const BASE_CLASSES =
  "inline-block text-xs uppercase tracking-wide rounded-full px-2 py-0.5 bg-[var(--dpf-surface-2)]";

export function FreshnessBadge({ freshness }: Props): ReactElement {
  if (freshness === null || freshness === undefined) {
    return (
      <span className={`${BASE_CLASSES} text-[var(--dpf-muted)]`}>Unknown</span>
    );
  }

  if (freshness === "fresh") {
    return (
      <span className={`${BASE_CLASSES} text-[var(--dpf-accent)]`}>Fresh</span>
    );
  }

  if (freshness === "stale") {
    return (
      <span className={`${BASE_CLASSES} text-[var(--dpf-muted)]`}>Stale</span>
    );
  }

  // "retired"
  return (
    <span className={`${BASE_CLASSES} line-through text-[var(--dpf-muted)]`}>
      Retired
    </span>
  );
}
