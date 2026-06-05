import { getRiskAssessment, listControls } from "@/lib/actions/compliance";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LinkRiskControlForm } from "@/components/compliance/LinkRiskControlForm";
import { UnlinkRiskControlButton } from "@/components/compliance/UnlinkRiskControlButton";
import { LocalTime } from "@/components/ui/LocalTime";
import { StatusBadge } from "@/components/ui/report-kit";

type Props = { params: Promise<{ id: string }> };

export default async function RiskDetailPage({ params }: Props) {
  const { id } = await params;
  let risk;
  try {
    risk = await getRiskAssessment(id);
  } catch {
    notFound();
  }

  const allControls = await listControls();
  const existingControlIds = risk.controls.map((link) => link.control.id);
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
        <Link href="/compliance/risks" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">Risks</Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">{risk.title}</span>
      </div>

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-xl font-bold text-[var(--dpf-text)]">{risk.title}</h1>
          <StatusBadge intent={risk.status === "active" ? "success" : "neutral"} label={risk.status} variant="soft" uppercase={false} />
        </div>
        <div className="flex gap-2 mt-1">
          <StatusBadge domain="severity" status={risk.inherentRisk} label={`Inherent: ${risk.inherentRisk}`} variant="soft" uppercase={false} />
          {risk.residualRisk && (
            <StatusBadge domain="severity" status={risk.residualRisk} label={`Residual: ${risk.residualRisk}`} variant="soft" uppercase={false} />
          )}
          <StatusBadge domain="severity" status={risk.likelihood} label={`Likelihood: ${risk.likelihood}`} variant="soft" uppercase={false} />
          <StatusBadge domain="severity" status={risk.severity} label={`Severity: ${risk.severity}`} variant="soft" uppercase={false} />
        </div>
      </div>

      {/* Metadata grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
          <p className="text-xs text-[var(--dpf-muted)]">Hazard</p>
          <p className="text-sm font-semibold text-[var(--dpf-text)]">{risk.hazard}</p>
        </div>
        {risk.scope && (
          <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">Scope</p>
            <p className="text-sm font-semibold text-[var(--dpf-text)]">{risk.scope}</p>
          </div>
        )}
        {risk.assessedBy && (
          <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">Assessed By</p>
            <p className="text-sm font-semibold text-[var(--dpf-text)]">{risk.assessedBy.displayName}</p>
          </div>
        )}
        <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
          <p className="text-xs text-[var(--dpf-muted)]">Assessed At</p>
          <LocalTime value={risk.assessedAt} mode="date" className="text-sm font-semibold text-[var(--dpf-text)]" />
        </div>
        {risk.nextReviewDate && (
          <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">Next Review</p>
            <LocalTime value={risk.nextReviewDate} utc className="text-sm font-semibold text-[var(--dpf-text)]" />
          </div>
        )}
        <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
          <p className="text-xs text-[var(--dpf-muted)]">Controls</p>
          <p className="text-sm font-semibold text-[var(--dpf-text)]">{risk.controls.length}</p>
        </div>
        <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
          <p className="text-xs text-[var(--dpf-muted)]">Incidents</p>
          <p className="text-sm font-semibold text-[var(--dpf-text)]">{risk.incidents.length}</p>
        </div>
      </div>

      {/* Notes */}
      {risk.notes && (
        <div className="mb-6">
          <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-2">Notes</h2>
          <p className="text-sm text-[var(--dpf-text)]">{risk.notes}</p>
        </div>
      )}

      {/* Linked Controls */}
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest">
          Controls ({risk.controls.length})
        </h2>
        <LinkRiskControlForm
          riskAssessmentId={risk.id}
          existingControlIds={existingControlIds}
          availableControls={availableControls}
        />
      </div>
      {risk.controls.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)] mb-6">No controls linked.</p>
      ) : (
        <div className="space-y-2 mb-6">
          {risk.controls.map((link) => (
            <div
              key={link.control.id}
              className="p-3 rounded-lg border border-[var(--dpf-border)] flex items-start justify-between gap-3"
            >
              <div className="min-w-0">
                <Link
                  href={`/compliance/controls/${link.control.id}`}
                  className="text-sm text-[var(--dpf-text)] hover:text-[var(--dpf-accent)] transition-colors"
                >
                  {link.control.title}
                </Link>
                <span className="text-[9px] text-[var(--dpf-muted)] ml-2">{link.control.controlId}</span>
                {link.mitigationNotes && (
                  <p className="text-xs text-[var(--dpf-muted)] mt-1">{link.mitigationNotes}</p>
                )}
              </div>
              <UnlinkRiskControlButton riskAssessmentId={risk.id} controlId={link.control.id} />
            </div>
          ))}
        </div>
      )}

      {/* Linked Incidents */}
      <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-3">
        Incidents ({risk.incidents.length})
      </h2>
      {risk.incidents.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)]">No incidents linked.</p>
      ) : (
        <div className="space-y-2">
          {risk.incidents.map((inc) => {
            const isOpen = inc.status === "open" || inc.status === "investigating";
            return (
              <Link
                key={inc.id}
                href={`/compliance/incidents/${inc.id}`}
                className={`block p-3 rounded-lg border ${inc.regulatoryNotifiable && isOpen ? "border-[color-mix(in_srgb,var(--dpf-error)_50%,transparent)]" : "border-[var(--dpf-border)]"} hover:border-[var(--dpf-accent)] transition-colors`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-[var(--dpf-text)]">{inc.title}</span>
                      {inc.regulatoryNotifiable && (
                        <StatusBadge intent="danger" label="Notifiable" variant="soft" />
                      )}
                    </div>
                    <div className="flex gap-2 mt-1">
                      <StatusBadge domain="severity" status={inc.severity} variant="soft" uppercase={false} />
                      <StatusBadge intent={isOpen ? "warning" : "success"} label={inc.status} variant="soft" uppercase={false} />
                    </div>
                  </div>
                  <LocalTime value={inc.occurredAt} mode="date" className="text-xs text-[var(--dpf-muted)]" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
