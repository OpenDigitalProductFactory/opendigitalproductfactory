"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setOpportunityNextStep } from "@/lib/actions/opportunity-next-step";

// The activity-based-selling loop: one small control to plan the deal's next
// step. Renders the current plan (or an "overdue"/"none" nudge) + a date and
// optional note; saving logs a task on the timeline and clears dormancy.
export function NextStepControl({
  opportunityId,
  nextActivityAt,
}: {
  opportunityId: string;
  nextActivityAt: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const router = useRouter();

  const planned = nextActivityAt ? new Date(nextActivityAt) : null;
  const overdue = planned !== null && planned.getTime() < Date.now();

  function save() {
    if (!date) {
      setError("Pick a date.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await setOpportunityNextStep({ opportunityId, scheduledAt: date, note: note.trim() || undefined });
        setOpen(false);
        setDate("");
        setNote("");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    });
  }

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {planned ? (
          <span className={overdue ? "text-red-400" : "text-[var(--dpf-muted)]"}>
            Next step {overdue ? "was due" : "planned"} {planned.toLocaleDateString()}
          </span>
        ) : (
          <span className="text-amber-400">No next step planned</span>
        )}
        <button
          className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-0.5 text-[11px] text-[var(--dpf-text)] hover:border-[var(--dpf-accent)]"
          onClick={() => setOpen((v) => !v)}
        >
          {planned ? "Reschedule" : "Set next step"}
        </button>
      </div>
      {open && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="date"
            className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1 text-xs text-[var(--dpf-text)]"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <input
            type="text"
            placeholder="What's the step? (optional)"
            className="min-w-40 flex-1 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1 text-xs text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)]"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            className="rounded bg-[var(--dpf-accent)] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
            disabled={isPending}
            onClick={save}
          >
            {isPending ? "Saving…" : "Save"}
          </button>
          {error && <span className="text-[11px] text-red-400">{error}</span>}
        </div>
      )}
    </div>
  );
}
