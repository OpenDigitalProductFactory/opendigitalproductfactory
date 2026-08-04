// apps/web/app/(shell)/compliance/posture/page.tsx
import { getCompliancePosture, getPostureTrend, takeComplianceSnapshot } from "@/lib/actions/reporting";
import { StatCard, StatusBadge, intentStyle } from "@/components/ui/report-kit";
import { Chart } from "@/components/ui/report-kit/Chart";
import { PostureTrendTable, type PostureSnapshotRow } from "./PostureTrendTable";
import { scoreIntent } from "./posture-score";

export default async function PosturePage() {
  const [posture, trend] = await Promise.all([
    getCompliancePosture(),
    getPostureTrend(12),
  ]);

  const obligationPct = posture.totalObligations > 0
    ? Math.round((posture.coveredObligations / posture.totalObligations) * 100)
    : 100;
  const controlPct = posture.totalControls > 0
    ? Math.round((posture.implementedControls / posture.totalControls) * 100)
    : 100;

  // Serialize snapshots for the client table + chart (chronological for the trend line).
  const rows: PostureSnapshotRow[] = trend.map((s) => ({
    snapshotId: s.snapshotId,
    takenAtISO: new Date(s.takenAt).toISOString(),
    overallScore: s.overallScore,
    coveredObligations: s.coveredObligations,
    totalObligations: s.totalObligations,
    implementedControls: s.implementedControls,
    totalControls: s.totalControls,
    openIncidents: s.openIncidents,
    overdueActions: s.overdueActions,
    triggeredBy: s.triggeredBy,
  }));
  const chartData = [...rows]
    .sort((a, b) => a.takenAtISO.localeCompare(b.takenAtISO))
    .map((s) => ({ date: s.takenAtISO.slice(0, 10), score: s.overallScore }));

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

      {/* Overall Score + key metrics */}
      <div className="flex items-center gap-6 mb-8">
        <div className="text-center">
          <p className="text-5xl font-bold" style={{ color: intentStyle(scoreIntent(posture.overallScore)).fg }}>
            {posture.overallScore}
          </p>
          <p className="text-xs text-[var(--dpf-muted)] mt-1">Overall Score</p>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 flex-1">
          <StatCard label="Obligation Coverage" value={`${obligationPct}%`}
            hint={`${posture.coveredObligations}/${posture.totalObligations}`}
            intent={scoreIntent(obligationPct)} />
          <StatCard label="Control Implementation" value={`${controlPct}%`}
            hint={`${posture.implementedControls}/${posture.totalControls}`}
            intent={scoreIntent(controlPct)} />
          <StatCard label="Open Incidents" value={posture.openIncidents}
            hint={posture.openIncidents === 0 ? "Clear" : "Active"}
            intent={posture.openIncidents === 0 ? "success" : "danger"} />
          <StatCard label="Overdue Actions" value={posture.overdueActions}
            hint={posture.overdueActions === 0 ? "On track" : "Needs attention"}
            intent={posture.overdueActions === 0 ? "success" : "warning"} />
        </div>
      </div>

      {/* By Function (domain) — the centralized rollup of what each functional context must apply */}
      <section className="mb-8">
        <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-3">By Function</h2>
        {posture.domainScores.length === 0 ? (
          <p className="text-sm text-[var(--dpf-muted)]">No applicable regulations yet.</p>
        ) : (
          <div className="space-y-2">
            {posture.domainScores.map((d) => (
              <div key={d.domain} className="p-3 rounded-lg border border-[var(--dpf-border)] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-[var(--dpf-text)]">{d.label}</span>
                  <StatusBadge intent="neutral"
                    label={`${d.regulationCount} regulation${d.regulationCount !== 1 ? "s" : ""}`}
                    variant="soft" uppercase={false} />
                </div>
                <div className="flex items-center gap-4 text-xs text-[var(--dpf-muted)]">
                  <span>{d.coveredObligations}/{d.totalObligations} covered</span>
                  <span className="font-semibold" style={{ color: intentStyle(scoreIntent(d.coveragePercent)).fg }}>
                    {d.coveragePercent}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

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
                  <StatusBadge intent="neutral" label={r.jurisdiction} variant="soft" uppercase={false} />
                </div>
                <div className="flex items-center gap-4 text-xs text-[var(--dpf-muted)]">
                  <span>{r.coveredObligations}/{r.totalObligations} covered</span>
                  <span className="font-semibold" style={{ color: intentStyle(scoreIntent(r.obligationCoverage)).fg }}>
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
          <div className="space-y-4">
            {chartData.length > 1 && (
              <div className="rounded-lg border border-[var(--dpf-border)] p-3">
                <Chart
                  type="area"
                  data={chartData}
                  xKey="date"
                  series={[{ key: "score", label: "Overall Score", intent: "accent" }]}
                  height={220}
                />
              </div>
            )}
            <PostureTrendTable rows={rows} />
          </div>
        )}
      </section>
    </div>
  );
}
