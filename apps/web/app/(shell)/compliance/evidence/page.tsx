import { listEvidence } from "@/lib/actions/compliance";
import { EVIDENCE_TYPES } from "@/lib/compliance-types";
import Link from "next/link";
import { prisma } from "@dpf/db";
import { CreateEvidenceForm } from "@/components/compliance/CreateEvidenceForm";

type Props = { searchParams: Promise<{ evidenceType?: string; status?: string }> };

export default async function EvidencePage({ searchParams }: Props) {
  const sp = await searchParams;
  const filters = {
    ...(sp.evidenceType && { evidenceType: sp.evidenceType }),
    ...(sp.status && { status: sp.status }),
  };
  const hasFilters = Object.keys(filters).length > 0;
  const [evidence, obligations, controls] = await Promise.all([
    listEvidence(hasFilters ? filters : undefined),
    prisma.obligation.findMany({ where: { status: "active" }, select: { id: true, title: true }, orderBy: { title: "asc" } }),
    prisma.control.findMany({ where: { status: "active" }, select: { id: true, title: true }, orderBy: { title: "asc" } }),
  ]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-[var(--dpf-text)]">Evidence</h1>
          <p className="text-sm text-[var(--dpf-muted)] mt-0.5">{evidence.length} active record{evidence.length !== 1 ? "s" : ""}</p>
        </div>
        <CreateEvidenceForm obligations={obligations} controls={controls} />
      </div>

      {/* Filter bar */}
      <form className="flex flex-wrap gap-3 mb-6">
        <select name="evidenceType" defaultValue={sp.evidenceType ?? ""}
          className="text-xs px-2 py-1.5 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-text)] focus:outline-none focus:border-[var(--dpf-accent)]">
          <option value="">All types</option>
          {EVIDENCE_TYPES.map((t) => (
            <option key={t} value={t}>{t.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</option>
          ))}
        </select>

        <select name="status" defaultValue={sp.status ?? ""}
          className="text-xs px-2 py-1.5 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-text)] focus:outline-none focus:border-[var(--dpf-accent)]">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="superseded">Superseded</option>
          <option value="expired">Expired</option>
        </select>

        <button type="submit"
          className="text-xs px-3 py-1.5 rounded-md bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity">
          Filter
        </button>

        {hasFilters && (
          <Link href="/compliance/evidence"
            className="text-xs px-3 py-1.5 rounded-md border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] transition-colors">
            Clear
          </Link>
        )}
      </form>

      {evidence.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)]">No evidence matches the current filters.</p>
      ) : (
        <div className="space-y-2">
          {evidence.map((e) => (
            <Link key={e.id} href={`/compliance/evidence/${e.id}`} className="block p-3 rounded-lg border border-[var(--dpf-border)] hover:border-[var(--dpf-accent)] transition-colors">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-sm text-[var(--dpf-text)]">{e.title}</span>
                  <div className="flex gap-2 mt-1">
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">{e.evidenceType}</span>
                    {e.obligation && <span className="text-[9px] text-[var(--dpf-muted)]">&rarr; {e.obligation.title}</span>}
                    {e.control && <span className="text-[9px] text-[var(--dpf-muted)]">&rarr; {e.control.title}</span>}
                  </div>
                </div>
                <div className="text-right text-xs text-[var(--dpf-muted)]">
                  <p>{new Date(e.collectedAt).toLocaleDateString()}</p>
                  {e.collectedBy && <p>{e.collectedBy.displayName}</p>}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
