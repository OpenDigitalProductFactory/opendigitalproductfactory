"use client";

import { useTransition } from "react";
import { triggerBootstrapDiscovery } from "@/lib/actions/discovery";
import type { DiscoveryHealthSummary } from "@/lib/discovery-data";

type DiscoveryRun = {
  runKey: string;
  status: string;
  trigger: string;
  itemCount: number;
  relationshipCount: number;
  startedAt: Date;
  completedAt: Date | null;
} | null;

export function DiscoveryRunSummary({
  run,
  health,
}: {
  run: DiscoveryRun;
  health: DiscoveryHealthSummary;
}) {
  const [isPending, startTransition] = useTransition();

  const handleSweep = () => {
    startTransition(async () => {
      await triggerBootstrapDiscovery();
    });
  };

  return (
    <section className="rounded-xl border border-white/10 bg-[var(--dpf-surface-1)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--dpf-muted)]">
            Bootstrap Discovery
          </p>
          <h2 className="mt-1 text-lg font-semibold text-[var(--dpf-text)]">
            {run ? run.runKey : "No discovery run yet"}
          </h2>
          <p className="mt-1 text-sm text-[var(--dpf-muted)]">
            {run
              ? `${run.status} via ${run.trigger}`
              : "Run bootstrap discovery to populate foundational inventory."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSweep}
            disabled={isPending}
            className="rounded-md bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] px-3 py-1.5 text-xs font-medium text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-1)] disabled:opacity-50 transition-colors"
          >
            {isPending ? "Running..." : "Run Sweep"}
          </button>
          {run && (
            <span className="rounded-full bg-[#4ade8020] px-2 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-[#4ade80]">
              {run.status}
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-[var(--dpf-surface-2)] p-3">
          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">
            Entities
          </p>
          <p className="mt-1 text-xl font-semibold text-[var(--dpf-text)]">{health.totalEntities}</p>
        </div>
        <div className="rounded-lg bg-[var(--dpf-surface-2)] p-3">
          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">
            Stale
          </p>
          <p className="mt-1 text-xl font-semibold text-[#fbbf24]">{health.staleEntities}</p>
        </div>
        <div className="rounded-lg bg-[var(--dpf-surface-2)] p-3">
          <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">
            Open Issues
          </p>
          <p className="mt-1 text-xl font-semibold text-[#fb7185]">{health.openIssues}</p>
        </div>
      </div>

      {run && (
        <p className="mt-4 text-xs text-[var(--dpf-muted)]">
          {run.itemCount} items and {run.relationshipCount} relationships processed.
        </p>
      )}
    </section>
  );
}
