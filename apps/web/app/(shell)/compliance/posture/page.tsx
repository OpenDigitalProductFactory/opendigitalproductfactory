// apps/web/app/(shell)/compliance/posture/page.tsx
import { getCompliancePosture, getPostureTrend, takeComplianceSnapshot } from "@/lib/actions/reporting";

export default async function PosturePage() {
  const [posture, trend] = await Promise.all([
    getCompliancePosture(),
    getPostureTrend(12),
  ]);

  const scoreColor = posture.overallScore >= 80 ? "#4ade80" : posture.overallScore >= 60 ? "#fbbf24" : "#ef4444";

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-[var(--dpf-text)]">Compliance Posture</h1>
          <p className="text-sm text-[var(--dpf-muted)] mt-0.5">Point-in-time compliance health</p>
        </div>
        <form action={async () => { "use server"; await takeComplianceSnapshot("manual"); }}>
          <button type="submit"
            className="px-3 py-1.5 text-xs font-medium rounded bg-[var(--dpf-accent)] text-white hover:opacity-90">
            Take Snapshot
          </button>
        </form>
      </div>

      {/* Overall Score */}
      <div className="flex items-center gap-6 mb-8">
        <div className="text-center">
          <p className="text-5xl font-bold" style={{ color: scoreColor }}>{posture.overallScore}</p>
          <p className="text-xs text-[var(--dpf-muted)] mt-1">Overall Score</p>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 flex-1">
          <MetricCard label="Obligation Coverage" value={`${posture.totalObligations > 0 ? Math.round((posture.coveredObligations / posture.totalObligations) * 100) : 100}%`} sub={`${posture.coveredObligations}/${posture.totalObligations}`} />
          <MetricCard label="Control Implementation" value={`${posture.totalControls > 0 ? Math.round((posture.implementedControls / posture.totalControls) * 100) : 100}%`} sub={`${posture.implementedControls}/${posture.totalControls}`} />
          <MetricCard label="Open Incidents" value={posture.openIncidents} sub={posture.openIncidents === 0 ? "Clear" : "Active"} />
          <MetricCard label="Overdue Actions" value={posture.overdueActions} sub={posture.overdueActions === 0 ? "On track" : "Needs attention"} />
        </div>
      </div>

      {/* Per-Regulation Breakdown */}
      <section className="mb-8">
        <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-3">By Regulation</h2>
        {posture.regulationScores.length === 0 ? (
          <p className="text-sm text-[var(--dpf-muted)]">No regulations registered.</p>
        ) : (
          <div className="space-y-2">
            {posture.regulationScores.map((r) => (
              <div key={r.id} className="p-3 rounded-lg border border-[var(--dpf-border)] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-[var(--dpf-text)]">{r.shortName}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">{r.jurisdiction}</span>
                </div>
                <div className="flex items-center gap-4 text-xs text-[var(--dpf-muted)]">
                  <span>{r.coveredObligations}/{r.totalObligations} covered</span>
                  <span className={`font-semibold ${r.obligationCoverage >= 80 ? "text-green-400" : r.obligationCoverage >= 50 ? "text-yellow-400" : "text-red-400"}`}>
                    {r.obligationCoverage}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Trend */}
      <section>
        <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-3">Trend ({trend.length} snapshots)</h2>
        {trend.length === 0 ? (
          <p className="text-sm text-[var(--dpf-muted)]">No snapshots yet. Take a snapshot to start tracking trends.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[var(--dpf-muted)] border-b border-[var(--dpf-border)]">
                  <th className="py-2 pr-4">Date</th>
                  <th className="py-2 pr-4">Score</th>
                  <th className="py-2 pr-4">Obligations</th>
                  <th className="py-2 pr-4">Controls</th>
                  <th className="py-2 pr-4">Incidents</th>
                  <th className="py-2 pr-4">Overdue</th>
                  <th className="py-2">Trigger</th>
                </tr>
              </thead>
              <tbody>
                {trend.map((s) => (
                  <tr key={s.snapshotId} className="border-b border-[var(--dpf-border)]">
                    <td className="py-2 pr-4 text-[var(--dpf-text)]">{new Date(s.takenAt).toLocaleDateString()}</td>
                    <td className="py-2 pr-4">
                      <span className={`font-semibold ${s.overallScore >= 80 ? "text-green-400" : s.overallScore >= 60 ? "text-yellow-400" : "text-red-400"}`}>
                        {s.overallScore}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-[var(--dpf-muted)]">{s.coveredObligations}/{s.totalObligations}</td>
                    <td className="py-2 pr-4 text-[var(--dpf-muted)]">{s.implementedControls}/{s.totalControls}</td>
                    <td className="py-2 pr-4 text-[var(--dpf-muted)]">{s.openIncidents}</td>
                    <td className="py-2 pr-4 text-[var(--dpf-muted)]">{s.overdueActions}</td>
                    <td className="py-2 text-[var(--dpf-muted)]">{s.triggeredBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function MetricCard({ label, value, sub }: { label: string; value: number | string; sub: string }) {
  return (
    <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
      <p className="text-xs text-[var(--dpf-muted)]">{label}</p>
      <p className="text-lg font-bold text-[var(--dpf-text)]">{value}</p>
      <p className="text-[9px] text-[var(--dpf-muted)]">{sub}</p>
    </div>
  );
}
