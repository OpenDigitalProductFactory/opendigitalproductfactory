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

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { getSelfUpgradeRunImpact } from "@/lib/actions/promotions";
import type {
  RunImpactDigest,
  UpgradeImpactSummary,
} from "@/lib/self-upgrade/impact/types";
import { UpgradeScopeRibbon } from "@/components/ops/UpgradeScopeRibbon";
import { ImpactItemRow } from "@/components/ops/ImpactItemRow";
import { InlineBusy } from "@/components/ui/InlineBusy";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { isExpectedDuringSwap } from "@/lib/self-upgrade/is-expected-during-swap";

/** How long to wait before re-fetching after a swap-window transport failure. */
export const RUN_IMPACT_RETRY_MS = 3_000;

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
  // Distinct from `error`: the request never landed because the portal is
  // being swapped out by the very upgrade this row describes. That is the
  // expected shape of a running upgrade, not a defect (BI-D77BF495 handling,
  // extended here — expanding a RUNNING row used to print Next's sanitized
  // "An unexpected response was received from the server." as if the page
  // had broken).
  const [reconnecting, setReconnecting] = useState(false);
  const [isPending, startTransition] = useTransition();
  const loadedRef = useRef(false);

  const load = useCallback(() => {
    startTransition(async () => {
      try {
        setSummary(await getSelfUpgradeRunImpact(runId));
        loadedRef.current = true;
        setReconnecting(false);
        setError(null);
      } catch (err) {
        if (isExpectedDuringSwap(err)) {
          setReconnecting(true);
        } else {
          setError(getErrorMessage(err));
        }
      }
    });
  }, [runId]);

  // Keep retrying for as long as the row is open and the portal is mid-swap;
  // the list appears on its own once the new container answers.
  useEffect(() => {
    if (!expanded || !reconnecting) return;
    const timer = setTimeout(load, RUN_IMPACT_RETRY_MS);
    return () => clearTimeout(timer);
  }, [expanded, reconnecting, load]);

  function toggle() {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    // Fetch once per row — a second expand replays what is already held, and
    // while reconnecting the retry effect already owns the next attempt.
    if (loadedRef.current || isPending || reconnecting) return;
    setError(null);
    load();
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
        <div className="pt-1" aria-busy={isPending || reconnecting || undefined}>
          {isPending && <InlineBusy label="Loading changes…" />}
          {!isPending && reconnecting && (
            <div
              className="text-dpf-caption text-[var(--dpf-muted)]"
              role="status"
              aria-live="polite"
              data-run-impact-reconnecting={runId}
            >
              Portal is restarting to finish this upgrade. The list loads
              when it is back.
            </div>
          )}
          {error && (
            <div className="text-dpf-caption text-[var(--dpf-destructive)]">{error}</div>
          )}
          {!isPending && !error && !reconnecting && loadedRef.current && items.length === 0 && (
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
