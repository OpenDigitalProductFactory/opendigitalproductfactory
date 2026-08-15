"use client";

// apps/web/components/ops/ImpactItemRow.tsx
//
// One change in an upgrade impact summary, rendered as a categorised row.
//
// Two surfaces show the same thing and must not drift: the "What's in this
// update?" panel (the upgrade you are deciding on) and a Run History row
// expanded to show what a PAST upgrade carried. The badge vocabulary is the
// operator's read of "what kind of change is this?", so it lives in one place.

import type { ImpactItem } from "@/lib/self-upgrade/impact/types";

const CATEGORY_LABEL: Record<ImpactItem["category"], string> = {
  breaking: "Breaking",
  security: "Security",
  feature: "New",
  performance: "Faster",
  fix: "Fix",
  dependency: "Dependency",
  documentation: "Docs",
  maintenance: "Internal",
  other: "Other",
};

const NEUTRAL_BADGE =
  "bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)] border-[var(--dpf-border)]";

const CATEGORY_BADGE: Record<ImpactItem["category"], string> = {
  breaking:
    "bg-[var(--dpf-destructive)]/15 text-[var(--dpf-destructive)] border-[var(--dpf-destructive)]/30",
  security:
    "bg-[var(--dpf-destructive)]/10 text-[var(--dpf-destructive)] border-[var(--dpf-destructive)]/25",
  feature:
    "bg-[var(--dpf-success)]/15 text-[var(--dpf-success)] border-[var(--dpf-success)]/30",
  performance:
    "bg-[var(--dpf-info)]/15 text-[var(--dpf-info)] border-[var(--dpf-info)]/30",
  fix:
    "bg-[var(--dpf-warning)]/15 text-[var(--dpf-warning)] border-[var(--dpf-warning)]/30",
  dependency:
    "bg-[var(--dpf-info)]/10 text-[var(--dpf-info)] border-[var(--dpf-info)]/25",
  documentation: NEUTRAL_BADGE,
  maintenance: NEUTRAL_BADGE,
  other: NEUTRAL_BADGE,
};

// Summaries persisted before a category existed replay from JSON, so a row can
// carry a category this build has no entry for. Fall back to the neutral badge
// and a readable label instead of rendering `undefined`.
export function categoryLabel(category: ImpactItem["category"]): string {
  return CATEGORY_LABEL[category] ?? "Other";
}

export function categoryBadge(category: ImpactItem["category"]): string {
  return CATEGORY_BADGE[category] ?? NEUTRAL_BADGE;
}

export function ImpactItemRow({
  item,
  phrasing,
}: {
  item: ImpactItem;
  phrasing?: { description: string; whyRelevant: string };
}) {
  // Default view: phrased text; never SHAs or paths. Fall back to the raw
  // commit description if LLM phrasing is unavailable.
  const description = phrasing?.description ?? item.description;
  const whyRelevant = phrasing?.whyRelevant ?? "";
  return (
    <li
      className="py-2 px-3 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] space-y-1"
      data-impact-category={item.category}
      data-touches-customizations={item.touchesCustomizations ? "true" : "false"}
    >
      <div className="flex items-start gap-2">
        <span
          className={`shrink-0 px-2 py-0.5 rounded-full border text-dpf-caption uppercase tracking-wide ${categoryBadge(item.category)}`}
        >
          {categoryLabel(item.category)}
        </span>
        <span className="text-sm text-[var(--dpf-text)]">{description}</span>
      </div>
      {whyRelevant && (
        <div className="text-xs text-[var(--dpf-muted)] pl-1">
          <span className="font-medium text-[var(--dpf-text)]">Why relevant: </span>
          {whyRelevant}
        </div>
      )}
      {item.touchesCustomizations && (
        <div className="text-xs text-[var(--dpf-warning)] pl-1">
          Touches your customizations — may need merge review.
        </div>
      )}
    </li>
  );
}
