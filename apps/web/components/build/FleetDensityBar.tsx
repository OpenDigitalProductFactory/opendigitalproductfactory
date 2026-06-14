// apps/web/components/build/FleetDensityBar.tsx
//
// Compact completion-density bar for a fleet row, shown only during the Build
// phase. A glanceable proportional fill (done / failed / remaining) that lets
// the operator compare progress across many builds at once — the fleet-list
// analogue of the per-task AgentActivityStrip grid.
//
// Divergence from spec §6.1's "5×5px cells": a literal per-task cell grid
// (20–50 cells) overflows the ≤32px fleet row. A fixed-width proportional bar
// stays bounded regardless of task count while preserving the
// density-at-a-glance signal; exact counts live in the tooltip + aria-label.
//
// Data: FeatureBuildRow.taskResults (done / failed) vs buildPlan.tasks.length
// (denominator). No CustomEvent subscription — fleet rows refresh on the list
// refetch cycle, so "running" is not distinguished (folded into "remaining").
//
// Spec: docs/superpowers/specs/2026-06-13-agent-activity-strip-design.md §6.1
"use client";

import type { BuildPlanDoc, TaskResult } from "@/lib/feature-build-types";

type Props = {
  taskResults: TaskResult[] | null;
  buildPlan: BuildPlanDoc | null;
};

export function FleetDensityBar({ taskResults, buildPlan }: Props) {
  const total = buildPlan?.tasks?.length ?? 0;
  if (total === 0) return null;

  // Dedupe by title — a retried task can appear twice; last result wins.
  // Mirrors AgentActivityStrip's resultByTitle reduction so both surfaces
  // count completion the same way.
  const byTitle = new Map<string, boolean>();
  for (const r of taskResults ?? []) {
    byTitle.set(r.title, r.testResult?.passed ?? true);
  }
  let done = 0;
  let failed = 0;
  for (const passed of byTitle.values()) {
    if (passed) done++;
    else failed++;
  }

  // taskResults can exceed the plan length if the plan shrank between runs;
  // widen the denominator so the segments never sum past 100%.
  const denom = Math.max(total, done + failed);
  const donePct = (done / denom) * 100;
  const failedPct = (failed / denom) * 100;

  const label =
    failed > 0
      ? `Tasks: ${done} of ${total} done, ${failed} failed`
      : `Tasks: ${done} of ${total} done`;

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-testid="fleet-density-bar"
      data-done={done}
      data-failed={failed}
      data-total={total}
      className="box-border inline-flex h-1.5 w-11 shrink-0 overflow-hidden rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-3)]"
    >
      {donePct > 0 && (
        <span
          aria-hidden="true"
          className="h-full bg-[var(--dpf-success)]"
          style={{ width: `${donePct}%` }}
        />
      )}
      {failedPct > 0 && (
        <span
          aria-hidden="true"
          className="h-full bg-[var(--dpf-error)]"
          style={{ width: `${failedPct}%` }}
        />
      )}
    </span>
  );
}
