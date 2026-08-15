"use client";

// apps/web/components/ops/RunImpactDetail.tsx
//
// "What did this upgrade carry?" for one row of the self-upgrade Run History.
//
// A completed run was identified by a SHA pair and a status badge, so the
// question an operator actually asks after something goes wrong — *which*
// upgrade introduced this, and when? — could only be answered by reading the
// database. The summary is already persisted against the run
// (SelfUpgradeRun.impactSummaryId → UpgradeImpactSummary), so this surfaces it:
// the headline + counts inline, and the full item list on demand.
//
// Loading is lazy and per-row: a page of history ships only digests, and the
// item list is fetched for the one run the operator expands. Read-only — it
// carries the record, it does not re-derive it, so a run keeps reporting the
// changes IT applied even after upstream has moved on.

import { useState, useTransition } from "react";
import { getSelfUpgradeRunImpact } from "@/lib/actions/promotions";
import type {
  RunImpactDigest,
  UpgradeImpactSummary,
} from "@/lib/self-upgrade/impact/types";
import { UpgradeScopeRibbon } from "@/components/ops/UpgradeScopeRibbon";
import { ImpactItemRow } from "@/components/ops/ImpactItemRow";
import { InlineBusy } from "@/components/ui/InlineBusy";
import { getErrorMessage } from "@/lib/shared/get-error-message";

export function RunImpactDetail({
  runId,
  digest,
}: {
  runId: string;
  digest: RunImpactDigest;
}) {
  const [expanded, setExpanded] = useState(false);
  const [summary, setSummary] = useState<UpgradeImpactSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggle() {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    // Fetch once per row — a second expand replays what is already held.
    if (summary || isPending) return;
    setError(null);
    startTransition(async () => {
      try {
        setSummary(await getSelfUpgradeRunImpact(runId));
      } catch (err) {
        setError(getErrorMessage(err));
      }
    });
  }

  const items = summary?.allItems ?? [];

  return (
    <div className="space-y-1" data-run-impact={runId}>
      <UpgradeScopeRibbon
        surface="history"
        counts={digest.counts}
        headline={digest.headline}
      />
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className="text-dpf-caption text-[var(--dpf-accent)] hover:underline"
      >
        {expanded ? "Hide changes" : "View changes"}
      </button>

      {expanded && (
        <div className="pt-1" aria-busy={isPending || undefined}>
          {isPending && <InlineBusy label="Loading changes…" />}
          {error && (
            <div className="text-dpf-caption text-[var(--dpf-destructive)]">{error}</div>
          )}
          {!isPending && !error && items.length === 0 && (
            // The digest exists but the item list does not — say so plainly
            // rather than rendering an empty box that reads as "no changes".
            <div className="text-dpf-caption text-[var(--dpf-muted)]">
              This run recorded a summary, but its change list is no longer
              available.
            </div>
          )}
          {items.length > 0 && (
            <ul className="space-y-1.5" data-run-impact-items={runId}>
              {items.map((item, idx) => (
                <ImpactItemRow
                  key={item.sha}
                  item={item}
                  phrasing={
                    // Phrasings are positional against topItems only; anything
                    // past that renders its raw commit description.
                    idx < (summary?.topItems.length ?? 0)
                      ? summary?.phrased?.itemPhrasings[idx]
                      : undefined
                  }
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
