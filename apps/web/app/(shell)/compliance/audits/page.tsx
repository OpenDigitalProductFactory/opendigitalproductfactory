import { listAudits } from "@/lib/actions/compliance";
import { AUDIT_TYPES, AUDIT_STATUSES } from "@/lib/compliance-types";
import Link from "next/link";
import { CreateAuditForm } from "@/components/compliance/CreateAuditForm";

const STATUS_COLORS: Record<string, string> = {
  planned: "bg-blue-900/30 text-blue-400",
  "in-progress": "bg-yellow-900/30 text-yellow-400",
  completed: "bg-green-900/30 text-green-400",
  cancelled: "bg-gray-900/30 text-gray-400",
};

type Props = { searchParams: Promise<{ auditType?: string; status?: string }> };

export default async function AuditsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const filters = {
    ...(sp.auditType && { auditType: sp.auditType }),
    ...(sp.status && { status: sp.status }),
  };
  const hasFilters = Object.keys(filters).length > 0;
  const audits = await listAudits(hasFilters ? filters : undefined);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Audits</h1>
          <p className="text-sm text-[var(--dpf-muted)] mt-0.5">{audits.length} total</p>
        </div>
        <CreateAuditForm />
      </div>

      {/* Filter bar */}
      <form className="flex flex-wrap gap-3 mb-6">
        <select name="auditType" defaultValue={sp.auditType ?? ""}
          className="text-xs px-2 py-1.5 rounded-md border border-[var(--dpf-border)] bg-[#1a1a1a] text-white focus:outline-none focus:border-[var(--dpf-accent)]">
          <option value="">All types</option>
          {AUDIT_TYPES.map((t) => (
            <option key={t} value={t}>{t.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</option>
          ))}
        </select>

        <select name="status" defaultValue={sp.status ?? ""}
          className="text-xs px-2 py-1.5 rounded-md border border-[var(--dpf-border)] bg-[#1a1a1a] text-white focus:outline-none focus:border-[var(--dpf-accent)]">
          <option value="">All statuses</option>
          {AUDIT_STATUSES.map((s) => (
            <option key={s} value={s}>{s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</option>
          ))}
        </select>

        <button type="submit"
          className="text-xs px-3 py-1.5 rounded-md bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity">
          Filter
        </button>

        {hasFilters && (
          <Link href="/compliance/audits"
            className="text-xs px-3 py-1.5 rounded-md border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-white transition-colors">
            Clear
          </Link>
        )}
      </form>

      {audits.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)]">No audits match the current filters.</p>
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
