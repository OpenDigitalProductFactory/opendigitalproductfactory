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

import { useEffect, useState, useTransition } from "react";
import type { SummaryResult, ImpactItem } from "@/lib/self-upgrade/impact/types";
import { formatImpactCounts } from "@/lib/self-upgrade/impact/format";
import { CollapsibleList } from "@/components/ui/report-kit";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { InlineBusy } from "@/components/ui/InlineBusy";
import { Skeleton } from "@/components/ui/Skeleton";

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

// Shape-of-content placeholder shown while the summary generates (on the
// auto-fetch on first view, or a manual (re)summarize). Mirrors the OK-result
// layout below (headline line, counts line, item rows) so the panel resolves in
// place instead of popping. Decorative — the wrapping region carries aria-busy
// and the live announcement.
function SummarySkeleton() {
  return (
    <div className="space-y-3" data-summary-state="loading">
      <Skeleton width="85%" height="0.9rem" />
      <Skeleton width="35%" height="0.7rem" />
      <ul className="space-y-2">
        {[0, 1].map((i) => (
          <li
            key={i}
            className="py-2 px-3 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] space-y-1.5"
          >
            <div className="flex items-start gap-2">
              <Skeleton width="2.5rem" height="1rem" rounded />
              <Skeleton width={i === 0 ? "70%" : "55%"} />
            </div>
            <Skeleton width="45%" height="0.7rem" />
          </li>
        ))}
      </ul>
    </div>
  );
}

function isSummaryResult(value: unknown): value is SummaryResult {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { ok?: unknown };
  return candidate.ok === true || candidate.ok === false;
}

async function fetchUpgradeImpactSummary(refresh: boolean): Promise<SummaryResult> {
  const params = new URLSearchParams();
  if (refresh) params.set("refresh", "true");
  const query = params.toString();

  const res = await fetch(
    `/api/ops/self-upgrade/impact-summary${query ? `?${query}` : ""}`,
    {
      method: "GET",
      cache: "no-store",
    },
  );

  const body: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const message =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : `Summary request failed with HTTP ${res.status}`;
    throw new Error(message);
  }

  if (!isSummaryResult(body)) {
    throw new Error("Unexpected summary response from the server.");
  }

  return body;
}

export default function UpgradeImpactPanel({
  enabled,
  initialSummary,
}: {
  enabled: boolean;
  // Persisted summary pre-loaded by the page server-component, so a previously
  // generated summary is shown immediately on load — no click, no recompute.
  initialSummary?: SummaryResult | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<SummaryResult | null>(initialSummary ?? null);
  const [error, setError] = useState<string | null>(null);

  function run(refresh = false) {
    setError(null);
    startTransition(async () => {
      try {
        const r = await fetchUpgradeImpactSummary(refresh);
        setResult(r);
      } catch (err) {
        setError(getErrorMessage(err));
      }
    });
  }

  // Auto-generate the glance summary on first view when the page shipped no
  // cached one. This is the git-walk (merge) + LLM work that used to run
  // synchronously in the server render and block the whole page 30-60s on the
  // first click after every upgrade (BI-4A400DE4). Moving it here lets the page
  // paint immediately; the summary streams in behind the existing `isPending`
  // affordance, and summarizeUpgradeImpact is cache-first so it only pays the
  // cost once per (lineage, target). Fires once on mount.
  useEffect(() => {
    if (enabled && !initialSummary) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!enabled) return null;

  // The top-N rows are always rendered. The "show more" disclosure must reveal
  // only the items NOT already shown above — rendering the full `allItems` here
  // repeated the entire truncated top-N list instead of extending it. Compute
  // the remainder as a set-difference by SHA so it is correct regardless of how
  // `topItems` is ordered relative to `allItems`.
  const summary = result?.ok ? result.summary : null;
  const remainingItems = (() => {
    if (!summary) return [];
    const shownShas = new Set(summary.topItems.map((i) => i.sha));
    return summary.allItems.filter((item) => !shownShas.has(item.sha));
  })();

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
            {isPending ? (
              <InlineBusy label="Summarizing…" />
            ) : result ? (
              "Re-open summary"
            ) : (
              "Summarize update"
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="text-xs text-[var(--dpf-destructive)] p-2 rounded bg-[var(--dpf-destructive)]/10">
          {error}
        </div>
      )}

      {/* First-time generation (auto on first view, or a manual summarize): a
          shape-of-content skeleton so the activity is visible and the panel
          resolves in place. Refreshing an existing summary keeps the prior
          content (dimmed) below instead. */}
      {isPending && !result && (
        <div aria-busy="true">
          <SummarySkeleton />
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
        <div
          className={`space-y-3 ${isPending ? "opacity-60 transition-opacity" : ""}`}
          data-summary-state="ok"
          aria-busy={isPending || undefined}
        >
          {result.summary.phrased?.headline && (
            <p className="text-sm text-[var(--dpf-text)]">
              {result.summary.phrased.headline}
            </p>
          )}

          <div className="text-xs text-[var(--dpf-muted)]" data-counts-line>
            {formatImpactCounts(result.summary.counts)}
          </div>

          {result.summary.phrased?.touchesCustomizationsCallout && (
            <div className="text-xs text-[var(--dpf-warning)] p-2 rounded bg-[var(--dpf-warning)]/10 border border-[var(--dpf-warning)]/30">
              {result.summary.phrased.touchesCustomizationsCallout}
            </div>
          )}

          {result.summary.topItems.length > 0 && (
            // Top-N rows always shown (with their "why relevant" phrasing); the
            // remainder reveals below, with the toggle anchored at the FOOT of the
            // list — never stranded mid-list the way the old <details> hinge left
            // "Show fewer" when expanded (EP-829D997C / BI-CB260C2D).
            <CollapsibleList
              previewCount={result.summary.topItems.length}
              moreLabel={(n) => `Show ${n} more change${n === 1 ? "" : "s"}`}
            >
              {[
                ...result.summary.topItems.map((item, idx) => (
                  <ItemRow
                    key={item.sha}
                    item={item}
                    phrasing={result.summary.phrased?.itemPhrasings[idx]}
                  />
                )),
                ...remainingItems.map((item) => (
                  <ItemRow key={item.sha} item={item} />
                )),
              ]}
            </CollapsibleList>
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
