import { prisma } from "@dpf/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CreateObligationForm } from "@/components/compliance/CreateObligationForm";
import { EditRegulationForm } from "@/components/compliance/EditRegulationForm";

type Props = { params: Promise<{ id: string }> };

export default async function RegulationDetailPage({ params }: Props) {
  const { id } = await params;
  const regulation = await prisma.regulation.findUnique({
    where: { id },
    include: {
      obligations: {
        orderBy: { title: "asc" },
        include: {
          ownerEmployee: { select: { displayName: true } },
          _count: { select: { controls: true } },
        },
      },
    },
  });
  if (!regulation) notFound();

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-2">
        <Link href="/compliance/regulations" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">Regulations</Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">{regulation.shortName}</span>
      </div>

      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-xl font-bold text-[var(--dpf-text)]">{regulation.shortName}</h1>
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">{regulation.jurisdiction}</span>
          <EditRegulationForm id={regulation.id} regulation={regulation} />
        </div>
        <p className="text-sm text-[var(--dpf-muted)]">{regulation.name}</p>
        {regulation.sourceUrl && (
          <a href={regulation.sourceUrl} target="_blank" rel="noopener noreferrer"
            className="text-xs text-blue-400 hover:underline mt-1 inline-block">
            Source document
          </a>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
          <p className="text-xs text-[var(--dpf-muted)]">Status</p>
          <p className="text-sm font-semibold text-[var(--dpf-text)]">{regulation.status}</p>
        </div>
        <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
          <p className="text-xs text-[var(--dpf-muted)]">Source Type</p>
          <p className="text-sm font-semibold text-[var(--dpf-text)]">{regulation.sourceType}</p>
        </div>
        <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
          <p className="text-xs text-[var(--dpf-muted)]">Obligations</p>
          <p className="text-sm font-semibold text-[var(--dpf-text)]">{regulation.obligations.length}</p>
        </div>
        {regulation.effectiveDate && (
          <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">Effective Date</p>
            <p className="text-sm font-semibold text-[var(--dpf-text)]">{new Date(regulation.effectiveDate).toLocaleDateString()}</p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest">Obligations</h2>
        <CreateObligationForm
          regulations={[{ id: regulation.id, shortName: regulation.shortName }]}
          defaultRegulationId={regulation.id}
        />
      </div>
      {regulation.obligations.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)]">No obligations defined yet.</p>
      ) : (
        <div className="space-y-2">
          {regulation.obligations.map((o) => {
            const hasControls = o._count.controls > 0;
            return (
              <div key={o.id} className="p-3 rounded-lg border border-[var(--dpf-border)] flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${hasControls ? "bg-green-400" : "bg-red-400"}`} />
                    <span className="text-sm text-[var(--dpf-text)]">{o.title}</span>
                  </div>
                  <div className="flex gap-2 mt-1">
                    {o.reference && <span className="text-[9px] text-[var(--dpf-muted)]">{o.reference}</span>}
                    {o.category && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">{o.category}</span>}
                  </div>
                </div>
                <div className="text-right text-xs text-[var(--dpf-muted)]">
                  <p>{o._count.controls} control{o._count.controls !== 1 ? "s" : ""}</p>
                  {o.ownerEmployee && <p>{o.ownerEmployee.displayName}</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
