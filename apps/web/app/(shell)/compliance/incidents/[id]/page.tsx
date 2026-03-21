import { getIncident } from "@/lib/actions/compliance";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EditIncidentForm } from "@/components/compliance/EditIncidentForm";

type Props = { params: Promise<{ id: string }> };

const SEVERITY_COLORS: Record<string, string> = {
  low: "bg-green-900/30 text-green-400",
  medium: "bg-yellow-900/30 text-yellow-400",
  high: "bg-orange-900/30 text-orange-400",
  critical: "bg-red-900/30 text-red-400",
};

const STATUS_COLORS: Record<string, string> = {
  open: "bg-yellow-900/30 text-yellow-400",
  investigating: "bg-orange-900/30 text-orange-400",
  resolved: "bg-green-900/30 text-green-400",
  closed: "bg-gray-900/30 text-gray-400",
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
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${SEVERITY_COLORS[incident.severity] ?? "bg-gray-900/30 text-gray-400"}`}>
            {incident.severity}
          </span>
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${STATUS_COLORS[incident.status] ?? "bg-gray-900/30 text-gray-400"}`}>
            {incident.status}
          </span>
          <EditIncidentForm id={incident.id} incident={incident} />
        </div>
        {incident.description && (
          <p className="text-sm text-[var(--dpf-muted)]">{incident.description}</p>
        )}
      </div>

      {/* Regulatory notification banner */}
      {incident.regulatoryNotifiable && (
        <div className={`mb-6 p-3 rounded-lg border ${deadlinePassed && !incident.notifiedAt ? "border-red-500/50 bg-red-900/10" : "border-amber-500/50 bg-amber-900/10"}`}>
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${deadlinePassed && !incident.notifiedAt ? "bg-red-900/30 text-red-400" : "bg-amber-900/30 text-amber-400"}`}>
              REGULATORY NOTIFIABLE
            </span>
            {incident.notifiedAt && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-900/30 text-green-400">NOTIFIED</span>
            )}
          </div>
          {incident.notificationDeadline && (
            <p className={`text-xs ${deadlinePassed && !incident.notifiedAt ? "text-red-400" : "text-amber-400"}`}>
              Notification deadline: {new Date(incident.notificationDeadline).toLocaleString()}
              {deadlinePassed && !incident.notifiedAt && " — OVERDUE"}
            </p>
          )}
          {incident.notifiedAt && (
            <p className="text-xs text-green-400">Notified at: {new Date(incident.notifiedAt).toLocaleString()}</p>
          )}
        </div>
      )}

      {/* Metadata grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
          <p className="text-xs text-[var(--dpf-muted)]">Occurred At</p>
          <p className="text-sm font-semibold text-[var(--dpf-text)]">{new Date(incident.occurredAt).toLocaleString()}</p>
        </div>
        {incident.detectedAt && (
          <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">Detected At</p>
            <p className="text-sm font-semibold text-[var(--dpf-text)]">{new Date(incident.detectedAt).toLocaleString()}</p>
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
            <span className="text-xs text-blue-400">View</span>
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
                className={`block p-3 rounded-lg border ${isOverdue ? "border-red-500/50" : "border-[var(--dpf-border)]"} hover:border-[var(--dpf-accent)] transition-colors`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-[var(--dpf-text)]">{a.title}</span>
                      {isOverdue && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-900/30 text-red-400 font-semibold">OVERDUE</span>
                      )}
                    </div>
                    <div className="flex gap-2 mt-1">
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">{a.sourceType}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                        a.status === "verified" ? "bg-green-900/30 text-green-400" :
                        a.status === "completed" ? "bg-blue-900/30 text-blue-400" :
                        a.status === "open" ? "bg-yellow-900/30 text-yellow-400" :
                        "bg-gray-900/30 text-gray-400"
                      }`}>
                        {a.status}
                      </span>
                    </div>
                  </div>
                  {a.dueDate && (
                    <span className={`text-xs ${isOverdue ? "text-red-400" : "text-[var(--dpf-muted)]"}`}>
                      Due: {new Date(a.dueDate).toLocaleDateString()}
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
