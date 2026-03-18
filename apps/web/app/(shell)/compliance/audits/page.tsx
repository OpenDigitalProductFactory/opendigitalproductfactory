import { prisma } from "@dpf/db";

const STATUS_COLORS: Record<string, string> = {
  planned: "bg-blue-900/30 text-blue-400",
  "in-progress": "bg-yellow-900/30 text-yellow-400",
  completed: "bg-green-900/30 text-green-400",
  cancelled: "bg-gray-900/30 text-gray-400",
};

export default async function AuditsPage() {
  const audits = await prisma.complianceAudit.findMany({
    include: {
      auditor: { select: { id: true, displayName: true } },
      _count: { select: { findings: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Audits</h1>
          <p className="text-sm text-[var(--dpf-muted)] mt-0.5">{audits.length} total</p>
        </div>
      </div>

      {audits.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)]">No audits scheduled yet.</p>
      ) : (
        <div className="space-y-2">
          {audits.map((a) => (
            <a key={a.id} href={`/compliance/audits/${a.id}`}
              className="block p-3 rounded-lg border border-[var(--dpf-border)] hover:border-[var(--dpf-accent)] transition-colors">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-sm text-white">{a.title}</span>
                  <div className="flex gap-2 mt-1">
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#333] text-[var(--dpf-muted)]">{a.auditType}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${STATUS_COLORS[a.status] ?? "bg-gray-900/30 text-gray-400"}`}>
                      {a.status}
                    </span>
                    {a.overallRating && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#333] text-[var(--dpf-muted)]">{a.overallRating}</span>
                    )}
                  </div>
                </div>
                <div className="text-right text-xs text-[var(--dpf-muted)]">
                  {a.scheduledAt && <p>Scheduled: {new Date(a.scheduledAt).toLocaleDateString()}</p>}
                  <p>{a._count.findings} finding{a._count.findings !== 1 ? "s" : ""}</p>
                  {a.auditor && <p>{a.auditor.displayName}</p>}
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
