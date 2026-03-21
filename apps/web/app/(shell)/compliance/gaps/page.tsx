// apps/web/app/(shell)/compliance/gaps/page.tsx
import { getGapAssessment } from "@/lib/actions/reporting";

const GAP_COLORS: Record<string, string> = {
  covered: "bg-green-400",
  partial: "bg-yellow-400",
  uncovered: "bg-red-400",
};

export default async function GapsPage() {
  const gaps = await getGapAssessment();

  const totalUncovered = gaps.reduce((sum, r) => sum + r.uncoveredObligations, 0);
  const totalPartial = gaps.reduce((sum, r) => sum + r.partialObligations, 0);
  const regsWithGaps = gaps.filter((r) => r.uncoveredObligations > 0 || r.partialObligations > 0).length;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Gap Assessment</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          {totalUncovered > 0 || totalPartial > 0
            ? `${totalUncovered} uncovered · ${totalPartial} partial across ${regsWithGaps} regulation${regsWithGaps !== 1 ? "s" : ""}`
            : "All obligations covered"}
        </p>
      </div>

      {gaps.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)]">No regulations registered yet.</p>
      ) : (
        <div className="space-y-6">
          {gaps.map((reg) => (
            <div key={reg.id} className="rounded-lg border border-[var(--dpf-border)] p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-[var(--dpf-text)]">{reg.shortName}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">{reg.jurisdiction}</span>
                </div>
                <span className={`text-sm font-semibold ${reg.coveragePercent >= 80 ? "text-green-400" : reg.coveragePercent >= 50 ? "text-yellow-400" : "text-red-400"}`}>
                  {reg.coveredObligations}/{reg.totalObligations} covered ({reg.coveragePercent}%)
                </span>
              </div>

              {reg.obligations.length === 0 ? (
                <p className="text-xs text-[var(--dpf-muted)]">No obligations defined.</p>
              ) : (
                <div className="space-y-1">
                  {reg.obligations.map((obl) => (
                    <div key={obl.id} className="flex items-center justify-between py-1">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${GAP_COLORS[obl.status]}`} />
                        <span className="text-sm text-[var(--dpf-text)]">{obl.title}</span>
                        {obl.reference && <span className="text-[9px] text-[var(--dpf-muted)]">{obl.reference}</span>}
                      </div>
                      <span className="text-xs text-[var(--dpf-muted)]">
                        {obl.implementedControlCount}/{obl.controlCount} control{obl.controlCount !== 1 ? "s" : ""}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
