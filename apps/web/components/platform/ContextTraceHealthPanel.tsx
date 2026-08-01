// apps/web/components/platform/ContextTraceHealthPanel.tsx
//
// Reads the per-turn arbitration traces (BI-3E218D80) on the Runtime Health page.
//
// WHY IT IS DEFERRED, and why that is not a workaround. /platform/ai/runtime-health sits
// at a frozen 515-word budget baseline, and the UX ratchet forbids a changed route from
// exceeding its own baseline. Putting a diagnostic table in the default view would blow
// that — correctly. `data-dpf-disclosure` marks the region so lib/ux-budget both COUNTS
// it as progressive disclosure and EXCISES its content from the measured scope, which is
// the honest shape anyway: this answers "why didn't the coworker know X" when an operator
// goes looking, and has no business in the lead band the rest of the time.
//
// WORDING DISCIPLINE. Every label describes the ARBITRATOR'S DECISION, never answer
// quality — "dropped on N turns", not "degraded N answers". The projection knows what was
// withheld from the model; it cannot know whether that mattered. Saying otherwise would
// rebuild, in a dashboard, exactly the attestation problem these planes were built to kill.

import type { ContextTraceHealth, SourceLoss } from "@/lib/tak/context-trace-health";
import { describeContextTraceHealth } from "@/lib/tak/context-trace-health";
import { DataTable, type Column } from "@/components/ui/report-kit/DataTable";

// Composed from the report-kit rather than hand-rolled. The platform has one canonical
// table primitive (kernel principle compose-report-kit-for-reporting-ux); hand-rolling
// markup here would be the same mistake as hand-rolling a disclosure construct — a local
// dialect the shared guarantees (empty state, token styling, numeric alignment) never
// reach. Note the guard that enforces this is a text scan, so even naming the raw element
// in a comment trips it.
const LOSS_COLUMNS: Column<SourceLoss>[] = [
  { key: "source", header: "Source", cell: (r) => r.source },
  { key: "dropped", header: "Dropped", align: "right", cell: (r) => r.droppedTurns },
  { key: "compressed", header: "Compressed", align: "right", cell: (r) => r.compressedTurns },
  { key: "tokens", header: "Tokens withheld", align: "right", cell: (r) => r.droppedTokens },
];

export function ContextTraceHealthPanel({
  health,
  sampleSize,
}: {
  health: ContextTraceHealth;
  sampleSize: number;
}) {
  const summary = describeContextTraceHealth(health);

  return (
    <details
      data-dpf-disclosure
      className="mt-6 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]"
    >
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-[var(--dpf-text)]">
        Context budget: what recent turns were given
      </summary>

      <div className="border-t border-[var(--dpf-border)] px-4 py-4 text-sm text-[var(--dpf-text)]">
        <p className="m-0">{summary}</p>
        <p className="mt-1 text-xs text-[var(--dpf-muted)]">
          Last {sampleSize} traced turns. Shows what the arbitrator withheld — not whether
          the answer was worse for it.
        </p>

        {health.turns > 0 && (
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-[var(--dpf-muted)]">Turns sampled</dt>
              <dd className="m-0 tabular-nums">{health.turns}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--dpf-muted)]">Turns losing context</dt>
              <dd className="m-0 tabular-nums">{health.turnsWithLoss}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--dpf-muted)]">Mean budget used</dt>
              <dd className="m-0 tabular-nums">{Math.round(health.meanUtilization * 100)}%</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--dpf-muted)]">Turns at the ceiling</dt>
              <dd className="m-0 tabular-nums">{health.turnsAtCeiling}</dd>
            </div>
          </dl>
        )}

        {health.losses.length > 0 && (
          <div className="mt-5">
            <DataTable<SourceLoss>
              columns={LOSS_COLUMNS}
              rows={health.losses}
              getRowKey={(row) => row.source}
              dense
            />
          </div>
        )}

        {health.byTier.length > 1 && (
          <p className="mt-4 text-xs text-[var(--dpf-muted)]">
            By model tier:{" "}
            {health.byTier
              .map((t) => `${t.modelTier} ${t.turnsWithLoss}/${t.turns}`)
              .join(" · ")}
          </p>
        )}
      </div>
    </details>
  );
}
