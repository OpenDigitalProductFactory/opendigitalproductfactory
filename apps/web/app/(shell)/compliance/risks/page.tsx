import { prisma } from "@dpf/db";

const RISK_COLORS: Record<string, string> = {
  low: "bg-green-900/30 text-green-400",
  medium: "bg-yellow-900/30 text-yellow-400",
  high: "bg-orange-900/30 text-orange-400",
  critical: "bg-red-900/30 text-red-400",
};

export default async function RisksPage() {
  const risks = await prisma.riskAssessment.findMany({
    where: { status: "active" },
    include: {
      assessedBy: { select: { id: true, displayName: true } },
      _count: { select: { controls: true, incidents: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Risk Assessments</h1>
          <p className="text-sm text-[var(--dpf-muted)] mt-0.5">{risks.length} active</p>
        </div>
      </div>

      {risks.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)]">No risk assessments yet.</p>
      ) : (
        <div className="space-y-2">
          {risks.map((r) => (
            <div key={r.id} className="p-3 rounded-lg border border-[var(--dpf-border)] flex items-start justify-between">
              <div>
                <span className="text-sm text-white">{r.title}</span>
                <div className="flex gap-2 mt-1">
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${RISK_COLORS[r.inherentRisk] ?? "bg-gray-900/30 text-gray-400"}`}>
                    Inherent: {r.inherentRisk}
                  </span>
                  {r.residualRisk && (
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${RISK_COLORS[r.residualRisk] ?? "bg-gray-900/30 text-gray-400"}`}>
                      Residual: {r.residualRisk}
                    </span>
                  )}
                  <span className="text-[9px] text-[var(--dpf-muted)]">{r.likelihood} / {r.severity}</span>
                </div>
              </div>
              <div className="text-right text-xs text-[var(--dpf-muted)]">
                <p>{r._count.controls} control{r._count.controls !== 1 ? "s" : ""}</p>
                <p>{r._count.incidents} incident{r._count.incidents !== 1 ? "s" : ""}</p>
                {r.assessedBy && <p>{r.assessedBy.displayName}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
