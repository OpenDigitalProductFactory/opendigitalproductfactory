"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { setWeeklyDigestDisposition } from "@/lib/actions/attention-digest";
import type { OwnerAttentionEntry } from "@/lib/attention/owner-projection";
import { buildWeeklyDigest, WEEKLY_DIGEST_ACTIONS } from "@/lib/attention/weekly-digest";
import type { WeeklyDigestDisposition } from "@/lib/attention/weekly-digest-preferences";
import { OwnerDecisionCards } from "./OwnerDecisionCards";

export function WeeklyDigestPanel({
  entries,
  nowMs,
  initialDisposition = null,
}: {
  entries: OwnerAttentionEntry[];
  nowMs: number;
  initialDisposition?: WeeklyDigestDisposition | null;
}) {
  const digest = buildWeeklyDigest(entries, nowMs);
  const [disposition, setDisposition] = useState<WeeklyDigestDisposition | null>(
    initialDisposition,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  if (digest.count === 0 || digest.status !== "ready") return null;

  const choose = (next: WeeklyDigestDisposition) => {
    setError(null);
    startTransition(async () => {
      const result = await setWeeklyDigestDisposition(digest.reviewOnIso, next);
      if (result.ok) {
        setDisposition(next);
        router.refresh();
      } else setError(result.error);
    });
  };

  if (disposition) {
    return (
      <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
        <p className="text-sm font-semibold text-[var(--dpf-text)]">
          {disposition === "cleared" ? "Weekly review cleared." : "Snoozed to next week."}
        </p>
        <p className="mt-1 text-xs text-[var(--dpf-muted)]">
          {disposition === "cleared"
            ? "Your digital team will keep these low-urgency items in hand."
            : "These items will stay out of today’s count and return with the next Friday review."}
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
      <div>
        <p className="text-sm font-semibold text-[var(--dpf-text)]">Friday review</p>
        <p className="mt-1 text-xs leading-relaxed text-[var(--dpf-muted)]">
          {digest.count} low-urgency {digest.count === 1 ? "item is" : "items are"} grouped here so
          they do not interrupt your week.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => choose("cleared")}
          className="min-h-9 rounded-md bg-[var(--dpf-accent)] px-3 py-2 text-xs font-semibold text-[var(--dpf-on-accent,var(--dpf-surface-1))] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
        >
          {WEEKLY_DIGEST_ACTIONS[0].label}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => choose("snoozed")}
          className="min-h-9 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-xs font-semibold text-[var(--dpf-text)] hover:border-[var(--dpf-accent)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
        >
          {WEEKLY_DIGEST_ACTIONS[1].label}
        </button>
      </div>

      {error ? (
        <p className="text-xs text-[var(--dpf-error)]" role="alert">
          {error}
        </p>
      ) : null}

      <OwnerDecisionCards entries={digest.entries} />
    </section>
  );
}
