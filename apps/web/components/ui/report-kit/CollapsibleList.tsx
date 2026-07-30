"use client";
// apps/web/components/ui/report-kit/CollapsibleList.tsx
//
// Canonical "show a preview, reveal the rest" list primitive for the reporting
// palette (EP-829D997C / BI-CB260C2D). Before this, every surface that wanted a
// truncated list hand-rolled its own useState + slice(0, N) + a bespoke toggle —
// ~5 divergent implementations, one of which (UpgradeImpactPanel) used a native
// <details> whose <summary> sat as a HINGE between the always-shown items and the
// expandable ones, stranding "Show fewer" in the MIDDLE of the list when open.
//
// This primitive fixes that class structurally: the toggle is ALWAYS rendered at
// the FOOT of the list, after the full set. Collapsed -> preview + "Show N more";
// expanded -> everything + "Show fewer". The affordance never floats mid-list.
//
// It takes already-rendered rows as `children` (not a render-prop) so it composes
// from server AND client parents — the client boundary is this component alone.
//
//   <CollapsibleList previewCount={5}>
//     {items.map((it) => <ItemRow key={it.id} item={it} />)}
//   </CollapsibleList>

import { Children, useId, useState, type ReactNode } from "react";

export interface CollapsibleListProps {
  /** The list rows, already rendered. Only the count and slicing are managed here. */
  children: ReactNode;
  /** How many rows are always visible. Rows beyond this reveal on expand. Default 5. */
  previewCount?: number;
  /** List element to render. Default "ul". Use "ol" for ordered, "div" for non-list rows. */
  as?: "ul" | "ol" | "div";
  /** Classes for the wrapper element. */
  className?: string;
  /** Classes for the list element (defaults to a small vertical rhythm). */
  listClassName?: string;
  /** Label for the expand control, given the hidden count. Default: "Show N more". */
  moreLabel?: (hidden: number) => string;
  /** Label for the collapse control. Default: "Show fewer". */
  fewerLabel?: string;
  /** Start expanded. Default false. */
  defaultExpanded?: boolean;
}

const DEFAULT_PREVIEW = 5;

export function CollapsibleList({
  children,
  previewCount = DEFAULT_PREVIEW,
  as = "ul",
  className,
  listClassName = "space-y-2",
  moreLabel = (n) => `Show ${n} more`,
  fewerLabel = "Show fewer",
  defaultExpanded = false,
}: CollapsibleListProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const listId = useId();

  // Flatten to a real array so we can count and slice regardless of how the
  // caller produced the rows (map, fragments, conditional nulls).
  const rows = Children.toArray(children);
  const total = rows.length;
  const hidden = Math.max(0, total - previewCount);
  const visible = expanded ? rows : rows.slice(0, previewCount);

  const List = as;

  return (
    // The trigger marker is conditional on `hidden > 0`: a list short enough to render
    // in full defers nothing, so claiming a disclosure region there would let a surface
    // satisfy the blocking `deferred-detail` budget check without deferring anything
    // (BI-2B196D07). Not excised from the measured scope — the preview rows below are
    // visible on arrival.
    <div className={className} {...(hidden > 0 ? { "data-dpf-disclosure-trigger": "" } : {})}>
      <List id={listId} className={listClassName}>
        {visible}
      </List>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={listId}
          className="mt-2 cursor-pointer text-xs text-[var(--dpf-accent)] hover:underline"
        >
          {expanded ? fewerLabel : moreLabel(hidden)}
        </button>
      )}
    </div>
  );
}
