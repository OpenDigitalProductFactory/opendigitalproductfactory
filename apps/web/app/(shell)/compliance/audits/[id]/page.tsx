import { prisma } from "@dpf/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTime } from "@/components/ui/LocalTime";
import { StatusBadge, type Intent } from "@/components/ui/report-kit";

type Props = { params: Promise<{ id: string }> };

const FINDING_INTENT: Record<string, Intent> = {
  "nonconformity-major": "danger",
  "nonconformity-minor": "warning",
  observation: "warning",
  opportunity: "info",
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
      {/* Breadcrumb */}
      <div className="mb-2">
        <Link href="/compliance/audits" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">Audits</Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">{audit.title}</span>
      </div>

      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">{audit.title}</h1>
        <div className="flex gap-2 mt-1">
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">{audit.auditType}</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">{audit.status}</span>
          {audit.overallRating && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">{audit.overallRating}</span>}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {audit.scheduledAt && (
          <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">Scheduled</p>
            <LocalTime value={audit.scheduledAt} mode="date" className="text-sm font-semibold text-[var(--dpf-text)]" />
          </div>
        )}
        {audit.conductedAt && (
          <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">Conducted</p>
            <LocalTime value={audit.conductedAt} mode="date" className="text-sm font-semibold text-[var(--dpf-text)]" />
          </div>
        )}
        <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
          <p className="text-xs text-[var(--dpf-muted)]">Findings</p>
          <p className="text-sm font-semibold text-[var(--dpf-text)]">{audit.findings.length}</p>
        </div>
        {audit.auditor && (
          <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">Auditor</p>
            <p className="text-sm font-semibold text-[var(--dpf-text)]">{audit.auditorName ?? audit.auditor.displayName}</p>
          </div>
        )}
      </div>

      {audit.scope && (
        <div className="mb-6">
          <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-2">Scope</h2>
          <p className="text-sm text-[var(--dpf-text)]">{audit.scope}</p>
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
                <span className="text-sm text-[var(--dpf-text)]">{f.title}</span>
                <div className="flex gap-2 mt-1">
                  <StatusBadge intent={FINDING_INTENT[f.findingType] ?? "neutral"} label={f.findingType} variant="soft" uppercase={false} />
                  <StatusBadge intent={f.status === "open" ? "warning" : "success"} label={f.status} variant="soft" uppercase={false} />
                  {f.control && <span className="text-[9px] text-[var(--dpf-muted)]">Control: {f.control.title}</span>}
                </div>
              </div>
              <div className="text-right text-xs text-[var(--dpf-muted)]">
                {f.dueDate && <p>Due: <LocalTime value={f.dueDate} utc /></p>}
                <p>{f._count.correctiveActions} action{f._count.correctiveActions !== 1 ? "s" : ""}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
