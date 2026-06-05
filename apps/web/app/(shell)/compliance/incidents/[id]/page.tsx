import { getIncident } from "@/lib/actions/compliance";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EditIncidentForm } from "@/components/compliance/EditIncidentForm";
import { LocalTime } from "@/components/ui/LocalTime";
import { StatusBadge, type Intent } from "@/components/ui/report-kit";

type Props = { params: Promise<{ id: string }> };

const INCIDENT_STATUS_INTENT: Record<string, Intent> = {
  open: "warning",
  investigating: "warning",
  resolved: "success",
  closed: "neutral",
};

export default async function IncidentDetailPage({ params }: Props) {
  const { id } = await params;
  let incident;
  try {
    incident = await getIncident(id);
  } catch {
    notFound();
  }

  const isOpen = incident.status === "open" || incident.status === "investigating";
  const deadlinePassed = incident.notificationDeadline && new Date(incident.notificationDeadline) < new Date();

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-2">
        <Link href="/compliance/incidents" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">Incidents</Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">{incident.title}</span>
      </div>

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-xl font-bold text-[var(--dpf-text)]">{incident.title}</h1>
          <StatusBadge domain="severity" status={incident.severity} variant="soft" uppercase={false} />
          <StatusBadge intent={INCIDENT_STATUS_INTENT[incident.status] ?? "neutral"} label={incident.status} variant="soft" uppercase={false} />
          <EditIncidentForm id={incident.id} incident={incident} />
        </div>
        {incident.description && (
          <p className="text-sm text-[var(--dpf-muted)]">{incident.description}</p>
        )}
      </div>

      {/* Regulatory notification banner */}
      {incident.regulatoryNotifiable && (
        <div className={`mb-6 p-3 rounded-lg border ${deadlinePassed && !incident.notifiedAt ? "border-[color-mix(in_srgb,var(--dpf-error)_50%,transparent)] bg-[color-mix(in_srgb,var(--dpf-error)_10%,transparent)]" : "border-[color-mix(in_srgb,var(--dpf-warning)_50%,transparent)] bg-[color-mix(in_srgb,var(--dpf-warning)_10%,transparent)]"}`}>
          <div className="flex items-center gap-2 mb-1">
            <StatusBadge intent={deadlinePassed && !incident.notifiedAt ? "danger" : "warning"} label="Regulatory notifiable" variant="soft" />
            {incident.notifiedAt && (
              <StatusBadge intent="success" label="Notified" variant="soft" />
            )}
          </div>
          {incident.notificationDeadline && (
            <p className={`text-xs ${deadlinePassed && !incident.notifiedAt ? "text-[var(--dpf-error)]" : "text-[var(--dpf-warning)]"}`}>
              Notification deadline: <LocalTime value={incident.notificationDeadline} />
              {deadlinePassed && !incident.notifiedAt && " — OVERDUE"}
            </p>
          )}
          {incident.notifiedAt && (
            <p className="text-xs text-[var(--dpf-success)]">Notified at: <LocalTime value={incident.notifiedAt} /></p>
          )}
        </div>
      )}

      {/* Metadata grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
          <p className="text-xs text-[var(--dpf-muted)]">Occurred At</p>
          <LocalTime value={incident.occurredAt} className="text-sm font-semibold text-[var(--dpf-text)]" />
        </div>
        {incident.detectedAt && (
          <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">Detected At</p>
            <LocalTime value={incident.detectedAt} className="text-sm font-semibold text-[var(--dpf-text)]" />
          </div>
        )}
        {incident.category && (
          <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">Category</p>
            <p className="text-sm font-semibold text-[var(--dpf-text)]">{incident.category}</p>
          </div>
        )}
        {incident.reportedBy && (
          <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">Reported By</p>
            <p className="text-sm font-semibold text-[var(--dpf-text)]">{incident.reportedBy.displayName}</p>
          </div>
        )}
        <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
          <p className="text-xs text-[var(--dpf-muted)]">Corrective Actions</p>
          <p className="text-sm font-semibold text-[var(--dpf-text)]">{incident.correctiveActions.length}</p>
        </div>
      </div>

      {/* Root Cause */}
      {incident.rootCause && (
        <div className="mb-6">
          <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-2">Root Cause</h2>
          <p className="text-sm text-[var(--dpf-text)]">{incident.rootCause}</p>
        </div>
      )}

      {/* Linked Risk Assessment */}
      {incident.riskAssessment && (
        <div className="mb-6">
          <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-2">Risk Assessment</h2>
          <Link
            href={`/compliance/risks/${incident.riskAssessment.id}`}
            className="inline-flex items-center gap-2 p-3 rounded-lg border border-[var(--dpf-border)] hover:border-[var(--dpf-accent)] transition-colors"
          >
            <span className="text-sm font-semibold text-[var(--dpf-text)]">{incident.riskAssessment.title}</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">{incident.riskAssessment.assessmentId}</span>
            <span className="text-xs text-[var(--dpf-info)]">View</span>
          </Link>
        </div>
      )}

      {/* Linked Corrective Actions */}
      <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-3">
        Corrective Actions ({incident.correctiveActions.length})
      </h2>
      {incident.correctiveActions.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)]">No corrective actions linked.</p>
      ) : (
        <div className="space-y-2">
          {incident.correctiveActions.map((a) => {
            const isOverdue = a.dueDate && new Date(a.dueDate) < new Date() && !["completed", "verified"].includes(a.status);
            return (
              <Link
                key={a.id}
                href={`/compliance/actions/${a.id}`}
                className={`block p-3 rounded-lg border ${isOverdue ? "border-[color-mix(in_srgb,var(--dpf-error)_50%,transparent)]" : "border-[var(--dpf-border)]"} hover:border-[var(--dpf-accent)] transition-colors`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-[var(--dpf-text)]">{a.title}</span>
                      {isOverdue && (
                        <StatusBadge intent="danger" label="Overdue" variant="soft" />
                      )}
                    </div>
                    <div className="flex gap-2 mt-1">
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">{a.sourceType}</span>
                      <StatusBadge domain="complianceAction" status={a.status} variant="soft" uppercase={false} />
                    </div>
                  </div>
                  {a.dueDate && (
                    <span className={`text-xs ${isOverdue ? "text-[var(--dpf-error)]" : "text-[var(--dpf-muted)]"}`}>
                      Due: <LocalTime value={a.dueDate} utc />
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
