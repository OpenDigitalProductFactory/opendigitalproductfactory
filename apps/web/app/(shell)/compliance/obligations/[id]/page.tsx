import { getObligation, listControls } from "@/lib/actions/compliance";
import { notFound } from "next/navigation";
import Link from "next/link";
import { LinkControlForm } from "@/components/compliance/LinkControlForm";
import { UnlinkControlButton } from "@/components/compliance/UnlinkControlButton";
import { EditObligationForm } from "@/components/compliance/EditObligationForm";

type Props = { params: Promise<{ id: string }> };

const IMPL_COLORS: Record<string, string> = {
  implemented: "bg-green-900/30 text-green-400",
  "in-progress": "bg-yellow-900/30 text-yellow-400",
  planned: "bg-blue-900/30 text-blue-400",
  "not-applicable": "bg-gray-900/30 text-gray-400",
};

export default async function ObligationDetailPage({ params }: Props) {
  const { id } = await params;
  let obligation;
  try {
    obligation = await getObligation(id);
  } catch {
    notFound();
  }

  const allControls = await listControls();
  const existingControlIds = obligation.controls.map((link) => link.control.id);
  const availableControls = allControls.map((c) => ({
    id: c.id,
    title: c.title,
    controlType: c.controlType,
    implementationStatus: c.implementationStatus,
  }));

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-2">
        <Link href="/compliance/obligations" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">Obligations</Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">{obligation.title}</span>
      </div>

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-xl font-bold text-[var(--dpf-text)]">{obligation.title}</h1>
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${obligation.status === "active" ? "bg-green-900/30 text-green-400" : "bg-red-900/30 text-red-400"}`}>
            {obligation.status}
          </span>
          <EditObligationForm id={obligation.id} obligation={obligation} />
        </div>
        {obligation.description && (
          <p className="text-sm text-[var(--dpf-muted)]">{obligation.description}</p>
        )}
      </div>

      {/* Metadata grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {obligation.reference && (
          <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">Reference</p>
            <p className="text-sm font-semibold text-[var(--dpf-text)]">{obligation.reference}</p>
          </div>
        )}
        {obligation.category && (
          <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">Category</p>
            <p className="text-sm font-semibold text-[var(--dpf-text)]">{obligation.category}</p>
          </div>
        )}
        {obligation.frequency && (
          <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">Frequency</p>
            <p className="text-sm font-semibold text-[var(--dpf-text)]">{obligation.frequency}</p>
          </div>
        )}
        {obligation.applicability && (
          <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">Applicability</p>
            <p className="text-sm font-semibold text-[var(--dpf-text)]">{obligation.applicability}</p>
          </div>
        )}
        {obligation.ownerEmployee && (
          <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">Owner</p>
            <p className="text-sm font-semibold text-[var(--dpf-text)]">{obligation.ownerEmployee.displayName}</p>
          </div>
        )}
        {obligation.reviewDate && (
          <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">Review Date</p>
            <p className="text-sm font-semibold text-[var(--dpf-text)]">{new Date(obligation.reviewDate).toLocaleDateString()}</p>
          </div>
        )}
        <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
          <p className="text-xs text-[var(--dpf-muted)]">Controls</p>
          <p className="text-sm font-semibold text-[var(--dpf-text)]">{obligation.controls.length}</p>
        </div>
        <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
          <p className="text-xs text-[var(--dpf-muted)]">Evidence</p>
          <p className="text-sm font-semibold text-[var(--dpf-text)]">{obligation.evidence.length}</p>
        </div>
      </div>

      {/* Penalty summary */}
      {obligation.penaltySummary && (
        <div className="mb-6">
          <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-2">Penalty Summary</h2>
          <p className="text-sm text-[var(--dpf-text)]">{obligation.penaltySummary}</p>
        </div>
      )}

      {/* Regulation link */}
      <div className="mb-6">
        <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-2">Regulation</h2>
        <Link
          href={`/compliance/regulations/${obligation.regulation.id}`}
          className="inline-flex items-center gap-2 p-3 rounded-lg border border-[var(--dpf-border)] hover:border-[var(--dpf-accent)] transition-colors"
        >
          <span className="text-sm font-semibold text-[var(--dpf-text)]">{obligation.regulation.shortName}</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">{obligation.regulation.jurisdiction}</span>
          <span className="text-xs text-blue-400">View</span>
        </Link>
      </div>

      {/* Linked controls */}
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest">
          Controls ({obligation.controls.length})
        </h2>
        <LinkControlForm
          obligationId={obligation.id}
          existingControlIds={existingControlIds}
          availableControls={availableControls}
        />
      </div>
      {obligation.controls.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)] mb-6">No controls linked yet.</p>
      ) : (
        <div className="space-y-2 mb-6">
          {obligation.controls.map((link) => (
            <div key={link.id} className="p-3 rounded-lg border border-[var(--dpf-border)] flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link
                  href={`/compliance/controls/${link.control.id}`}
                  className="text-sm text-[var(--dpf-text)] hover:text-[var(--dpf-accent)] transition-colors"
                >
                  {link.control.title}
                </Link>
                <div className="flex gap-2 mt-1">
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">{link.control.controlType}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${IMPL_COLORS[link.control.implementationStatus] ?? "bg-gray-900/30 text-gray-400"}`}>
                    {link.control.implementationStatus}
                  </span>
                  {link.control.effectiveness && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">{link.control.effectiveness}</span>
                  )}
                </div>
                {link.notes && (
                  <p className="text-xs text-[var(--dpf-muted)] mt-1">{link.notes}</p>
                )}
              </div>
              <UnlinkControlButton controlId={link.control.id} obligationId={obligation.id} />
            </div>
          ))}
        </div>
      )}

      {/* Linked evidence */}
      <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-3">
        Evidence ({obligation.evidence.length})
      </h2>
      {obligation.evidence.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)]">No evidence collected yet.</p>
      ) : (
        <div className="space-y-2">
          {obligation.evidence.map((e) => (
            <div key={e.id} className="p-3 rounded-lg border border-[var(--dpf-border)] flex items-start justify-between">
              <div>
                <span className="text-sm text-[var(--dpf-text)]">{e.title}</span>
                <div className="flex gap-2 mt-1">
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">{e.evidenceType}</span>
                  {e.fileRef && <span className="text-[9px] text-[var(--dpf-muted)]">{e.fileRef}</span>}
                </div>
              </div>
              <div className="text-right text-xs text-[var(--dpf-muted)]">
                <p>{new Date(e.collectedAt).toLocaleDateString()}</p>
                {e.retentionUntil && <p>Retain until: {new Date(e.retentionUntil).toLocaleDateString()}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
