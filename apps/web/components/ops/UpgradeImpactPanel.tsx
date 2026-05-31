"use client";

// apps/web/components/ops/UpgradeImpactPanel.tsx
//
// Operator-facing "What's in this update?" panel for the /ops self-upgrade
// page. On click, runs the impact-summary server action and renders:
//   - Headline (LLM-phrased summary)
//   - Counts ribbon (breaking / feature / fix / perf / other)
//   - Top-N items (each: plain description + "why relevant to you" line)
//   - Customizations-touched callout (when present)
//   - Foldable "show full list" view
//   - Provenance line (GitHub reachable? cache hit?)
//
// Advisory only — no buttons here queue or apply the upgrade.

import { useState, useTransition } from "react";
import { getUpgradeImpactSummary } from "@/lib/actions/upgrade-impact";
import type { SummaryResult, ImpactItem } from "@/lib/self-upgrade/impact/types";

const CATEGORY_LABEL: Record<ImpactItem["category"], string> = {
  breaking: "Breaking",
  feature: "New",
  performance: "Faster",
  fix: "Fix",
  other: "Other",
};

const CATEGORY_BADGE: Record<ImpactItem["category"], string> = {
  breaking:
    "bg-[var(--dpf-destructive)]/15 text-[var(--dpf-destructive)] border-[var(--dpf-destructive)]/30",
  feature:
    "bg-[var(--dpf-success)]/15 text-[var(--dpf-success)] border-[var(--dpf-success)]/30",
  performance:
    "bg-[var(--dpf-info)]/15 text-[var(--dpf-info)] border-[var(--dpf-info)]/30",
  fix:
    "bg-[var(--dpf-warning)]/15 text-[var(--dpf-warning)] border-[var(--dpf-warning)]/30",
  other:
    "bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)] border-[var(--dpf-border)]",
};

function countsLine(counts: {
  breaking: number;
  feature: number;
  fix: number;
  performance: number;
  other: number;
  total: number;
}): string {
  const parts: string[] = [];
  if (counts.breaking > 0) parts.push(`${counts.breaking} breaking`);
  if (counts.feature > 0) parts.push(`${counts.feature} new`);
  if (counts.performance > 0) parts.push(`${counts.performance} perf`);
  if (counts.fix > 0) parts.push(`${counts.fix} fix${counts.fix === 1 ? "" : "es"}`);
  if (counts.other > 0) parts.push(`${counts.other} other`);
  if (parts.length === 0) return `${counts.total} change${counts.total === 1 ? "" : "s"}`;
  return parts.join(" · ");
}

function ItemRow({
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
          className={`shrink-0 px-2 py-0.5 rounded-full border text-[10px] uppercase tracking-wide ${CATEGORY_BADGE[item.category]}`}
        >
          {CATEGORY_LABEL[item.category]}
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

export default function UpgradeImpactPanel({ enabled }: { enabled: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<SummaryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showFullList, setShowFullList] = useState(false);

  function run(refresh = false) {
    setError(null);
    startTransition(async () => {
      try {
        const r = await getUpgradeImpactSummary({ refresh });
        setResult(r);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  if (!enabled) return null;

  return (
    <div
      className="p-3 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] space-y-3"
      data-panel="upgrade-impact-summary"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-[var(--dpf-text)]">
            What&apos;s in this update?
          </div>
          <div className="text-xs text-[var(--dpf-muted)]">
            Plain-language summary of upstream changes since your last upgrade,
            tailored to this install. Advisory — does not apply anything.
          </div>
        </div>
        <div className="flex items-center gap-2">
          {result?.ok && (
            <button
              type="button"
              onClick={() => run(true)}
              disabled={isPending}
              className="px-2 py-1 text-xs rounded-lg border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] disabled:opacity-50"
            >
              Refresh
            </button>
          )}
          <button
            type="button"
            onClick={() => run(false)}
            disabled={isPending}
            aria-busy={isPending}
            className="px-3 py-1.5 text-xs rounded-lg bg-[var(--dpf-accent)]/20 text-[var(--dpf-accent)] border border-[var(--dpf-accent)]/40 hover:bg-[var(--dpf-accent)]/30 transition-colors disabled:opacity-50"
          >
            {isPending ? "Summarizing..." : result ? "Re-open summary" : "Summarize update"}
          </button>
        </div>
      </div>

      {error && (
        <div className="text-xs text-[var(--dpf-destructive)] p-2 rounded bg-[var(--dpf-destructive)]/10">
          {error}
        </div>
      )}

      {result && !result.ok && (
        <div
          className="text-xs text-[var(--dpf-muted)] p-3 rounded bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)]"
          data-summary-state={result.reason}
        >
          {result.detail}
        </div>
      )}

      {result?.ok && (
        <div className="space-y-3" data-summary-state="ok">
          {result.summary.phrased?.headline && (
            <p className="text-sm text-[var(--dpf-text)]">
              {result.summary.phrased.headline}
            </p>
          )}

          <div className="text-xs text-[var(--dpf-muted)]" data-counts-line>
            {countsLine(result.summary.counts)}
          </div>

          {result.summary.phrased?.touchesCustomizationsCallout && (
            <div className="text-xs text-[var(--dpf-warning)] p-2 rounded bg-[var(--dpf-warning)]/10 border border-[var(--dpf-warning)]/30">
              {result.summary.phrased.touchesCustomizationsCallout}
            </div>
          )}

          {result.summary.topItems.length > 0 && (
            <ul className="space-y-2">
              {result.summary.topItems.map((item, idx) => (
                <ItemRow
                  key={item.sha}
                  item={item}
                  phrasing={result.summary.phrased?.itemPhrasings[idx]}
                />
              ))}
            </ul>
          )}

          {result.summary.allItems.length > result.summary.topItems.length && (
            <details
              className="text-xs"
              open={showFullList}
              onToggle={(e) => setShowFullList((e.target as HTMLDetailsElement).open)}
            >
              <summary className="cursor-pointer text-[var(--dpf-accent)] hover:underline">
                Show all {result.summary.allItems.length} changes
              </summary>
              <ul className="space-y-2 mt-2">
                {result.summary.allItems.map((item) => (
                  <ItemRow key={item.sha} item={item} />
                ))}
              </ul>
            </details>
          )}

          <div className="text-[10px] text-[var(--dpf-muted)] pt-1">
            {result.summary.enrichment.githubReachable
              ? `Enriched ${result.summary.enrichment.prsEnriched} PR title${result.summary.enrichment.prsEnriched === 1 ? "" : "s"} from GitHub.`
              : "GitHub unreachable — summary built from commit subjects only."}
            {result.summary.fromCache && " · Served from cache."}
          </div>
        </div>
      )}
    </div>
  );
}
