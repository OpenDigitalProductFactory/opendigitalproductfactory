import { getRiskAssessment, listControls } from "@/lib/actions/compliance";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LinkRiskControlForm } from "@/components/compliance/LinkRiskControlForm";
import { UnlinkRiskControlButton } from "@/components/compliance/UnlinkRiskControlButton";

type Props = { params: Promise<{ id: string }> };

const RISK_COLORS: Record<string, string> = {
  low: "bg-green-900/30 text-green-400",
  medium: "bg-yellow-900/30 text-yellow-400",
  high: "bg-orange-900/30 text-orange-400",
  critical: "bg-red-900/30 text-red-400",
};

const SEVERITY_COLORS: Record<string, string> = {
  low: "bg-green-900/30 text-green-400",
  medium: "bg-yellow-900/30 text-yellow-400",
  high: "bg-orange-900/30 text-orange-400",
  critical: "bg-red-900/30 text-red-400",
};

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
        <Link href="/compliance/risks" className="text-xs text-[var(--dpf-muted)] hover:text-white">Risks</Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-white">{risk.title}</span>
      </div>

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-xl font-bold text-white">{risk.title}</h1>
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${risk.status === "active" ? "bg-green-900/30 text-green-400" : "bg-gray-900/30 text-gray-400"}`}>
            {risk.status}
          </span>
        </div>
        <div className="flex gap-2 mt-1">
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${RISK_COLORS[risk.inherentRisk] ?? "bg-gray-900/30 text-gray-400"}`}>
            Inherent: {risk.inherentRisk}
          </span>
          {risk.residualRisk && (
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${RISK_COLORS[risk.residualRisk] ?? "bg-gray-900/30 text-gray-400"}`}>
              Residual: {risk.residualRisk}
            </span>
          )}
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${RISK_COLORS[risk.likelihood] ?? "bg-gray-900/30 text-gray-400"}`}>
            Likelihood: {risk.likelihood}
          </span>
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${SEVERITY_COLORS[risk.severity] ?? "bg-gray-900/30 text-gray-400"}`}>
            Severity: {risk.severity}
          </span>
        </div>
      </div>

      {/* Metadata grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
          <p className="text-xs text-[var(--dpf-muted)]">Hazard</p>
          <p className="text-sm font-semibold text-white">{risk.hazard}</p>
        </div>
        {risk.scope && (
          <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">Scope</p>
            <p className="text-sm font-semibold text-white">{risk.scope}</p>
          </div>
        )}
        {risk.assessedBy && (
          <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">Assessed By</p>
            <p className="text-sm font-semibold text-white">{risk.assessedBy.displayName}</p>
          </div>
        )}
        <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
          <p className="text-xs text-[var(--dpf-muted)]">Assessed At</p>
          <p className="text-sm font-semibold text-white">{new Date(risk.assessedAt).toLocaleDateString()}</p>
        </div>
        {risk.nextReviewDate && (
          <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">Next Review</p>
            <p className="text-sm font-semibold text-white">{new Date(risk.nextReviewDate).toLocaleDateString()}</p>
          </div>
        )}
        <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
          <p className="text-xs text-[var(--dpf-muted)]">Controls</p>
          <p className="text-sm font-semibold text-white">{risk.controls.length}</p>
        </div>
        <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
          <p className="text-xs text-[var(--dpf-muted)]">Incidents</p>
          <p className="text-sm font-semibold text-white">{risk.incidents.length}</p>
        </div>
      </div>

      {/* Notes */}
      {risk.notes && (
        <div className="mb-6">
          <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-2">Notes</h2>
          <p className="text-sm text-white">{risk.notes}</p>
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
                  className="text-sm text-white hover:text-[var(--dpf-accent)] transition-colors"
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
                className={`block p-3 rounded-lg border ${inc.regulatoryNotifiable && isOpen ? "border-red-500/50" : "border-[var(--dpf-border)]"} hover:border-[var(--dpf-accent)] transition-colors`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-white">{inc.title}</span>
                      {inc.regulatoryNotifiable && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-900/30 text-red-400 font-semibold">NOTIFIABLE</span>
                      )}
                    </div>
                    <div className="flex gap-2 mt-1">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${SEVERITY_COLORS[inc.severity] ?? "bg-gray-900/30 text-gray-400"}`}>
                        {inc.severity}
                      </span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${isOpen ? "bg-yellow-900/30 text-yellow-400" : "bg-green-900/30 text-green-400"}`}>
                        {inc.status}
                      </span>
                    </div>
                  </div>
                  <span className="text-xs text-[var(--dpf-muted)]">{new Date(inc.occurredAt).toLocaleDateString()}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
