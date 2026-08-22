import type { BandTelemetry } from "@/lib/decision/band-telemetry";

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
        </p>
      </div>

      <p className="mt-1 text-sm text-[var(--dpf-muted)]">
        {share == null
          ? "Not enough decisions to read a distribution yet."
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
              className={
                bucket.insideUncertainBand
                  ? "w-full rounded-t-sm bg-[var(--dpf-warning)]"
                  : "w-full rounded-t-sm bg-[var(--dpf-accent)]"
              }
              style={{ height: `${Math.max(2, (bucket.count / peak) * 64)}px` }}
            />
            <span className="text-[10px] text-[var(--dpf-muted)]">{bucket.from.toFixed(1)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-[var(--dpf-muted)]">
        Bars left of the band edge
        {telemetry.typicalBandUpper == null ? "" : ` (${telemetry.typicalBandUpper.toFixed(2)})`} are
        decisions the gate could not call either way.
      </p>

      <table className="mt-4 w-full text-sm">
        <caption className="sr-only">Reversal rate by verdict band</caption>
        <thead>
          <tr className="text-left text-xs text-[var(--dpf-muted)]">
            <th scope="col" className="pb-1 font-normal">Band</th>
            <th scope="col" className="pb-1 font-normal">Judged</th>
            <th scope="col" className="pb-1 font-normal">Reversed</th>
          </tr>
        </thead>
        <tbody>
          {telemetry.reversals.map((band) => (
            <tr key={band.verdict} className="border-t border-[var(--dpf-border)]">
              <td className="py-1.5 capitalize text-[var(--dpf-text)]">{band.verdict}</td>
              <td className="py-1.5 text-[var(--dpf-muted)]">{band.judged}</td>
              <td className="py-1.5 text-[var(--dpf-text)]">
                {band.rate == null
                  ? <span className="text-[var(--dpf-muted)]">no call could be checked</span>
                  : `${band.reversed} (${Math.round(band.rate * 100)}%)`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
