"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { runDataStewardAction } from "@/lib/actions/data-stewardship";

export type AutoResolution = {
  activityId: string;
  subject: string;
  survivorId: string | null;
  loserId: string | null;
  reason: string | null;
  at: string;
};

/**
 * Autonomous Data Steward control + retro-review digest (BI-87C655D1).
 * The scheduled coworker works the queue down daily; this shows what it did
 * (each auto-merge undo-able via the tombstone's Undo-merge) and lets an
 * operator trigger a pass on demand (dry-run first).
 */
export function DataStewardPanel({ recent }: { recent: AutoResolution[] }) {
  const [result, setResult] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function run(dryRun: boolean) {
    setResult(null);
    startTransition(async () => {
      const r = await runDataStewardAction(dryRun);
      setResult(r.ok ? r.data : r.error);
    });
  }

  return (
    <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-4 py-3">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div>
          <p className="text-sm font-semibold text-[var(--dpf-text)]">Autonomous Data Steward</p>
          <p className="text-xs text-[var(--dpf-muted)]">
            Runs daily: sweeps, then auto-merges confident duplicates and escalates the rest. Every
            auto-merge is reversible from the merged account&apos;s page.
          </p>
        </div>
        <div className="flex gap-1.5 shrink-0">
          <button
            onClick={() => run(true)}
            disabled={isPending}
            className="px-2.5 py-1 rounded-md text-xs border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] disabled:opacity-50"
          >
            Preview
          </button>
          <button
            onClick={() => run(false)}
            disabled={isPending}
            className="px-2.5 py-1 rounded-md text-xs font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 disabled:opacity-50"
          >
            {isPending ? "Running…" : "Run now"}
          </button>
        </div>
      </div>

      {result && <p className="text-xs text-[var(--dpf-text)] mb-2">{result}</p>}

      {recent.length > 0 && (
        <div className="mt-2">
          <p className="text-[10px] uppercase tracking-wide text-[var(--dpf-muted)] mb-1">
            Auto-resolved (last 7 days)
          </p>
          <ul className="space-y-1">
            {recent.map((r) => (
              <li key={r.activityId} className="text-xs text-[var(--dpf-muted)]">
                {r.survivorId ? (
                  <Link href={`/customer/${r.survivorId}`} className="text-[var(--dpf-accent)] hover:underline">
                    {r.subject}
                  </Link>
                ) : (
                  r.subject
                )}
                {r.reason && ` — ${r.reason}`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
