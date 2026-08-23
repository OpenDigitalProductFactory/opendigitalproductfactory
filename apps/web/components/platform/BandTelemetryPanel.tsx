import { DataTable, type Column } from "@/components/ui/report-kit";
import type { BandReversal, BandTelemetry } from "@/lib/decision/band-telemetry";

const REVERSAL_COLUMNS: Column<BandReversal>[] = [
  { key: "verdict", header: "Band", cell: (b) => <span className="capitalize">{b.verdict}</span> },
  { key: "judged", header: "Judged", align: "right", cell: (b) => b.judged },
  {
    key: "reversed",
    header: "Reversed",
    align: "right",
    // A rate of null is reported as unjudgeable, never as a flattering 0%.
    cell: (b) => (b.rate == null
      ? <span className="text-[var(--dpf-muted)]">no call could be checked</span>
      : `${b.reversed} (${Math.round(b.rate * 100)}%)`),
  },
];

/**
 * BI-3217C098. The tuning instrument: where decisions land, and whether the
 * confident ones deserved their confidence.
 *
 * Both numbers are shown together on purpose. The uncertain share alone can be
 * driven to zero by lowering the bar, which looks like progress and is not — so
 * the reversal rate sits beside it, and an unjudgeable rate says so rather than
 * rendering a flattering 0%.
 */
export function BandTelemetryPanel({ telemetry }: { telemetry: BandTelemetry }) {
  if (telemetry.total === 0) return null;

  const peak = Math.max(1, ...telemetry.buckets.map((b) => b.count));
  const share = telemetry.uncertainShare;

  return (
    <section
      aria-labelledby="band-telemetry-title"
      className="rounded-lg border border-[var(--dpf-border)] p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="band-telemetry-title" className="text-base font-semibold text-[var(--dpf-text)]">
          Decision separation
        </h2>
        <p className="text-xs text-[var(--dpf-muted)]">
          {telemetry.scored} of {telemetry.total} decisions carried a margin
          {telemetry.classified < telemetry.total
            ? `, ${telemetry.classified} a verdict`
            : ""}
        </p>
      </div>

      <p className="mt-1 text-sm text-[var(--dpf-muted)]">
        {share == null
          ? "No decision here carries a verdict yet, so the band cannot be measured. Decisions recorded before the three bands existed cannot be classified after the fact — this reads as unmeasured, never as zero."
          : `${Math.round(share * 100)}% landed in the uncertain band. Tuning is working when this falls because decisions separate — not because the bar moved.`}
      </p>

      <ul className="mt-3 flex items-end gap-1" aria-label="Margin distribution">
        {telemetry.buckets.map((bucket) => (
          <li
            key={`${bucket.from}-${bucket.to}`}
            className="flex min-w-0 flex-1 flex-col items-center gap-1"
            title={`${bucket.count} decision(s) with a margin of ${bucket.from.toFixed(2)}–${bucket.to.toFixed(2)}`}
          >
            <span
              className="w-full rounded-t-sm"
              style={{
                height: `${Math.max(2, (bucket.count / peak) * 64)}px`,
                // Semantic, not decorative: inside the band is unresolved,
                // clear of it is an assurance.
                background: bucket.insideUncertainBand
                  ? "var(--dpf-warning)"
                  : "var(--dpf-success)",
              }}
            />
            <span className="text-xs text-[var(--dpf-muted)]">{bucket.from.toFixed(1)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-[var(--dpf-muted)]">
        Bars left of the band edge
        {telemetry.typicalBandUpper == null ? "" : ` (${telemetry.typicalBandUpper.toFixed(2)})`} are
        decisions the gate could not call either way.
      </p>

      <div className="mt-4">
        <DataTable
          ariaLabel="Reversal rate by verdict band"
          columns={REVERSAL_COLUMNS}
          rows={telemetry.reversals}
          getRowKey={(band) => band.verdict}
          dense
        />
      </div>
    </section>
  );
}
