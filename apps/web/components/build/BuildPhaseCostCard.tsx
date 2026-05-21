"use client";
// apps/web/components/build/BuildPhaseCostCard.tsx
//
// EP-COST Phase 3: per-phase cost breakdown for Build Studio operational panel.
// Shows token counts, duration, and estimated cost for each completed phase.
// Hidden when no BuildPhaseRun rows exist for this build (new builds or
// installs before EP-COST Phase 5 shipped).

import type { PhaseRunSummary } from "@/lib/build/progress-visibility";

const PHASE_ORDER = ["ideate", "plan", "build", "review", "ship"];
const PHASE_LABELS: Record<string, string> = {
  ideate: "Ideate",
  plan: "Plan",
  build: "Build",
  review: "Review",
  ship: "Ship",
};

function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1_000);
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

function formatTokens(n: number): string {
  if (n === 0) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function formatCost(s: string | null): string {
  if (!s) return "—";
  const n = parseFloat(s);
  if (isNaN(n) || n === 0) return "—";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(3)}`;
}

type Props = {
  phaseRuns: PhaseRunSummary[];
};

export function BuildPhaseCostCard({ phaseRuns }: Props) {
  if (phaseRuns.length === 0) return null;

  // Sort by canonical phase order
  const sorted = [...phaseRuns].sort((a, b) => {
    const ia = PHASE_ORDER.indexOf(a.phase);
    const ib = PHASE_ORDER.indexOf(b.phase);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  const totalTokens = sorted.reduce((s, r) => s + r.inputTokens + r.outputTokens, 0);
  const totalCost = sorted.reduce((s, r) => s + (r.costUsd ? parseFloat(r.costUsd) : 0), 0);
  const totalCalls = sorted.reduce((s, r) => s + r.inferenceCount, 0);

  return (
    <section className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase text-[var(--dpf-muted)]">Phase cost breakdown</p>
          <h3 className="mt-1 text-base font-semibold text-[var(--dpf-text)]">
            {totalCost > 0 ? `$${totalCost.toFixed(3)} estimated` : `${formatTokens(totalTokens)} tokens`}
          </h3>
        </div>
        <div className="text-right text-[11px] text-[var(--dpf-muted)]">
          <div>{totalCalls} inference calls</div>
          <div>{formatTokens(totalTokens)} total tokens</div>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--dpf-border)] text-left">
              <th className="pb-2 pr-3 text-[10px] font-medium uppercase tracking-wide text-[var(--dpf-muted)]">Phase</th>
              <th className="pb-2 pr-3 text-right text-[10px] font-medium uppercase tracking-wide text-[var(--dpf-muted)]">Duration</th>
              <th className="pb-2 pr-3 text-right text-[10px] font-medium uppercase tracking-wide text-[var(--dpf-muted)]">Tokens in</th>
              <th className="pb-2 pr-3 text-right text-[10px] font-medium uppercase tracking-wide text-[var(--dpf-muted)]">Tokens out</th>
              <th className="pb-2 pr-3 text-right text-[10px] font-medium uppercase tracking-wide text-[var(--dpf-muted)]">Calls</th>
              <th className="pb-2 text-right text-[10px] font-medium uppercase tracking-wide text-[var(--dpf-muted)]">Est. cost</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.phase} className="border-b border-[var(--dpf-border)] last:border-0">
                <td className="py-2 pr-3 font-medium text-[var(--dpf-text)]">
                  {PHASE_LABELS[r.phase] ?? r.phase}
                  {!r.completedAt && (
                    <span className="ml-1 text-[9px] text-[var(--dpf-accent)]">active</span>
                  )}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-[var(--dpf-muted)]">{formatDuration(r.durationMs)}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-[var(--dpf-text)]">{formatTokens(r.inputTokens)}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-[var(--dpf-text)]">{formatTokens(r.outputTokens)}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-[var(--dpf-muted)]">{r.inferenceCount || "—"}</td>
                <td className="py-2 text-right tabular-nums text-[var(--dpf-text)]">{formatCost(r.costUsd)}</td>
              </tr>
            ))}
          </tbody>
          {sorted.length > 1 && (
            <tfoot>
              <tr className="border-t-2 border-[var(--dpf-border)]">
                <td className="pt-2 pr-3 text-[10px] font-semibold uppercase text-[var(--dpf-muted)]">Total</td>
                <td className="pt-2 pr-3" />
                <td className="pt-2 pr-3 text-right tabular-nums font-medium text-[var(--dpf-text)]">
                  {formatTokens(sorted.reduce((s, r) => s + r.inputTokens, 0))}
                </td>
                <td className="pt-2 pr-3 text-right tabular-nums font-medium text-[var(--dpf-text)]">
                  {formatTokens(sorted.reduce((s, r) => s + r.outputTokens, 0))}
                </td>
                <td className="pt-2 pr-3 text-right tabular-nums font-medium text-[var(--dpf-text)]">{totalCalls}</td>
                <td className="pt-2 text-right tabular-nums font-semibold text-[var(--dpf-text)]">
                  {totalCost > 0 ? `$${totalCost.toFixed(3)}` : "—"}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="mt-3 text-[10px] text-[var(--dpf-muted)]">
        Cost estimated from per-model pricing in ModelProfile. Subscription providers (Claude, ChatGPT) show $0 — their fixed monthly cost is tracked in Finance → AI Spend.
      </p>
    </section>
  );
}
