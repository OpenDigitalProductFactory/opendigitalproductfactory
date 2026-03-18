import { prisma } from "@dpf/db";
import { notFound } from "next/navigation";

type Props = { params: Promise<{ id: string }> };

const FINDING_COLORS: Record<string, string> = {
  "nonconformity-major": "bg-red-900/30 text-red-400",
  "nonconformity-minor": "bg-orange-900/30 text-orange-400",
  observation: "bg-yellow-900/30 text-yellow-400",
  opportunity: "bg-blue-900/30 text-blue-400",
};

export default async function AuditDetailPage({ params }: Props) {
  const { id } = await params;
  const audit = await prisma.complianceAudit.findUnique({
    where: { id },
    include: {
      auditor: { select: { displayName: true } },
      findings: {
        include: {
          control: { select: { id: true, title: true } },
          _count: { select: { correctiveActions: true } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!audit) notFound();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">{audit.title}</h1>
        <div className="flex gap-2 mt-1">
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#333] text-[var(--dpf-muted)]">{audit.auditType}</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#333] text-[var(--dpf-muted)]">{audit.status}</span>
          {audit.overallRating && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#333] text-[var(--dpf-muted)]">{audit.overallRating}</span>}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {audit.scheduledAt && (
          <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">Scheduled</p>
            <p className="text-sm font-semibold text-white">{new Date(audit.scheduledAt).toLocaleDateString()}</p>
          </div>
        )}
        {audit.conductedAt && (
          <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">Conducted</p>
            <p className="text-sm font-semibold text-white">{new Date(audit.conductedAt).toLocaleDateString()}</p>
          </div>
        )}
        <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
          <p className="text-xs text-[var(--dpf-muted)]">Findings</p>
          <p className="text-sm font-semibold text-white">{audit.findings.length}</p>
        </div>
        {audit.auditor && (
          <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">Auditor</p>
            <p className="text-sm font-semibold text-white">{audit.auditorName ?? audit.auditor.displayName}</p>
          </div>
        )}
      </div>

      {audit.scope && (
        <div className="mb-6">
          <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-2">Scope</h2>
          <p className="text-sm text-white">{audit.scope}</p>
        </div>
      )}

      <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-3">Findings</h2>
      {audit.findings.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)]">No findings recorded.</p>
      ) : (
        <div className="space-y-2">
          {audit.findings.map((f) => (
            <div key={f.id} className="p-3 rounded-lg border border-[var(--dpf-border)] flex items-start justify-between">
              <div>
                <span className="text-sm text-white">{f.title}</span>
                <div className="flex gap-2 mt-1">
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${FINDING_COLORS[f.findingType] ?? "bg-gray-900/30 text-gray-400"}`}>
                    {f.findingType}
                  </span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${f.status === "open" ? "bg-yellow-900/30 text-yellow-400" : "bg-green-900/30 text-green-400"}`}>
                    {f.status}
                  </span>
                  {f.control && <span className="text-[9px] text-[var(--dpf-muted)]">Control: {f.control.title}</span>}
                </div>
              </div>
              <div className="text-right text-xs text-[var(--dpf-muted)]">
                {f.dueDate && <p>Due: {new Date(f.dueDate).toLocaleDateString()}</p>}
                <p>{f._count.correctiveActions} action{f._count.correctiveActions !== 1 ? "s" : ""}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
