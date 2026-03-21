import { getControl, listObligations } from "@/lib/actions/compliance";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LinkObligationForm } from "@/components/compliance/LinkObligationForm";
import { UnlinkControlButton } from "@/components/compliance/UnlinkControlButton";
import { EditControlForm } from "@/components/compliance/EditControlForm";

type Props = { params: Promise<{ id: string }> };

const STATUS_COLORS: Record<string, string> = {
  implemented: "bg-green-900/30 text-green-400",
  "in-progress": "bg-yellow-900/30 text-yellow-400",
  planned: "bg-blue-900/30 text-blue-400",
  "not-applicable": "bg-gray-900/30 text-gray-400",
};

const EFFECTIVENESS_COLORS: Record<string, string> = {
  effective: "bg-green-900/30 text-green-400",
  "partially-effective": "bg-yellow-900/30 text-yellow-400",
  ineffective: "bg-red-900/30 text-red-400",
  "not-assessed": "bg-gray-900/30 text-gray-400",
};

export default async function ControlDetailPage({ params }: Props) {
  const { id } = await params;
  let control;
  try {
    control = await getControl(id);
  } catch {
    notFound();
  }

  const allObligations = await listObligations();
  const existingObligationIds = control.obligations.map((link) => link.obligation.id);
  const availableObligations = allObligations.map((o) => ({
    id: o.id,
    title: o.title,
    reference: o.reference,
    regulationShortName: o.regulation?.shortName ?? null,
  }));

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-2">
        <Link href="/compliance/controls" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">Controls</Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">{control.title}</span>
      </div>

      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-xl font-bold text-[var(--dpf-text)]">{control.title}</h1>
          <EditControlForm id={control.id} control={control} />
        </div>
        <div className="flex gap-2 mt-1">
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">{control.controlType}</span>
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${STATUS_COLORS[control.implementationStatus] ?? "bg-gray-900/30 text-gray-400"}`}>
            {control.implementationStatus}
          </span>
          {control.effectiveness && (
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${EFFECTIVENESS_COLORS[control.effectiveness] ?? "bg-gray-900/30 text-gray-400"}`}>
              {control.effectiveness}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
          <p className="text-xs text-[var(--dpf-muted)]">Control Type</p>
          <p className="text-sm font-semibold text-[var(--dpf-text)]">{control.controlType}</p>
        </div>
        <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
          <p className="text-xs text-[var(--dpf-muted)]">Implementation Status</p>
          <p className="text-sm font-semibold text-[var(--dpf-text)]">{control.implementationStatus}</p>
        </div>
        {control.reviewFrequency && (
          <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">Review Frequency</p>
            <p className="text-sm font-semibold text-[var(--dpf-text)]">{control.reviewFrequency}</p>
          </div>
        )}
        {control.effectiveness && (
          <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">Effectiveness</p>
            <p className="text-sm font-semibold text-[var(--dpf-text)]">{control.effectiveness}</p>
          </div>
        )}
        {control.ownerEmployee && (
          <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">Owner</p>
            <p className="text-sm font-semibold text-[var(--dpf-text)]">{control.ownerEmployee.displayName}</p>
          </div>
        )}
        {control.nextReviewDate && (
          <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">Next Review</p>
            <p className="text-sm font-semibold text-[var(--dpf-text)]">{new Date(control.nextReviewDate).toLocaleDateString()}</p>
          </div>
        )}
      </div>

      {control.description && (
        <div className="mb-6">
          <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-2">Description</h2>
          <p className="text-sm text-[var(--dpf-text)]">{control.description}</p>
        </div>
      )}

      {/* Linked Obligations */}
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest">Linked Obligations</h2>
        <LinkObligationForm
          controlId={control.id}
          existingObligationIds={existingObligationIds}
          availableObligations={availableObligations}
        />
      </div>
      {control.obligations.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)] mb-6">No obligations linked.</p>
      ) : (
        <div className="space-y-2 mb-6">
          {control.obligations.map((link) => (
            <div key={link.obligation.id} className="p-3 rounded-lg border border-[var(--dpf-border)] flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link
                  href={`/compliance/obligations/${link.obligation.id}`}
                  className="text-sm text-[var(--dpf-text)] hover:text-[var(--dpf-accent)] transition-colors"
                >
                  {link.obligation.title}
                </Link>
                <span className="text-[9px] text-[var(--dpf-muted)] ml-2">{link.obligation.obligationId}</span>
              </div>
              <UnlinkControlButton controlId={control.id} obligationId={link.obligation.id} />
            </div>
          ))}
        </div>
      )}

      {/* Linked Evidence */}
      <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-3">Evidence</h2>
      {control.evidence.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)] mb-6">No evidence collected.</p>
      ) : (
        <div className="space-y-2 mb-6">
          {control.evidence.map((ev) => (
            <div key={ev.id} className="p-3 rounded-lg border border-[var(--dpf-border)] flex items-start justify-between">
              <div>
                <span className="text-sm text-[var(--dpf-text)]">{ev.title}</span>
                <div className="flex gap-2 mt-1">
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">{ev.evidenceType}</span>
                </div>
              </div>
              <span className="text-xs text-[var(--dpf-muted)]">{new Date(ev.collectedAt).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      )}

      {/* Linked Risk Assessments */}
      <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-3">Risk Assessments</h2>
      {control.riskAssessments.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)]">No risk assessments linked.</p>
      ) : (
        <div className="space-y-2">
          {control.riskAssessments.map((link) => (
            <Link key={link.riskAssessment.id} href={`/compliance/risks/${link.riskAssessment.id}`}
              className="block p-3 rounded-lg border border-[var(--dpf-border)] hover:border-[var(--dpf-accent)] transition-colors">
              <span className="text-sm text-[var(--dpf-text)]">{link.riskAssessment.title}</span>
              <span className="text-[9px] text-[var(--dpf-muted)] ml-2">{link.riskAssessment.assessmentId}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
