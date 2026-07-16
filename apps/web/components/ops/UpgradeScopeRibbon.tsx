// apps/web/components/ops/UpgradeScopeRibbon.tsx
//
// The at-a-glance one-liner for an upgrade's scope — a plain-language headline
// plus a "N changes · 1 breaking · 5 new · 3 fixes" ribbon. Shared by the
// "Update available" banner (the pending upgrade you're deciding on) and the
// Latest Run card (what a run carried), so both read as one system. The
// elaborate per-item panel lives in UpgradeImpactPanel; this is the glance.

import { formatImpactCounts } from "@/lib/self-upgrade/impact/format";
import type { ImpactCategoryCounts } from "@/lib/self-upgrade/impact/types";

export function UpgradeScopeRibbon({
  counts,
  headline,
  surface,
}: {
  counts: ImpactCategoryCounts;
  /** LLM one-line headline; omitted/null renders the ribbon alone. */
  headline?: string | null;
  /** Which surface this instance sits on ("run" | "available") — data hook. */
  surface: string;
}) {
  return (
    <>
      {headline && (
        <div className="text-sm text-[var(--dpf-text)]" data-impact-scope-headline={surface}>
          {headline}
        </div>
      )}
      <div className="text-xs" data-impact-scope-counts={surface}>
        <span className="text-[var(--dpf-text)]">
          {counts.total} change{counts.total === 1 ? "" : "s"}
        </span>
        <span className="text-[var(--dpf-muted)]"> · </span>
        {/* Breaking changes are the risk signal an operator most needs to see,
            so the ribbon takes the destructive color when any are present. */}
        <span
          className={
            counts.breaking > 0
              ? "text-[var(--dpf-destructive)]"
              : "text-[var(--dpf-muted)]"
          }
        >
          {formatImpactCounts(counts)}
        </span>
      </div>
    </>
  );
}
