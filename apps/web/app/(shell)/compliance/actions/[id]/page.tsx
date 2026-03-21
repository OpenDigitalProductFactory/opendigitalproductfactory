import { getCorrectiveAction } from "@/lib/actions/compliance";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EditCorrectiveActionForm } from "@/components/compliance/EditCorrectiveActionForm";

type Props = { params: Promise<{ id: string }> };

const STATUS_COLORS: Record<string, string> = {
  open: "bg-yellow-900/30 text-yellow-400",
  "in-progress": "bg-blue-900/30 text-blue-400",
  completed: "bg-blue-900/30 text-blue-400",
  verified: "bg-green-900/30 text-green-400",
  closed: "bg-gray-900/30 text-gray-400",
};

export default async function CorrectiveActionDetailPage({ params }: Props) {
  const { id } = await params;
  let action;
  try {
    action = await getCorrectiveAction(id);
  } catch {
    notFound();
  }

  const now = new Date();
  const isOverdue = action.dueDate && new Date(action.dueDate) < now && !["completed", "verified"].includes(action.status);

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-2">
        <Link href="/compliance/actions" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">Actions</Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">{action.title}</span>
      </div>

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-xl font-bold text-[var(--dpf-text)]">{action.title}</h1>
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${STATUS_COLORS[action.status] ?? "bg-gray-900/30 text-gray-400"}`}>
            {action.status}
          </span>
          {isOverdue && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-900/30 text-red-400 font-semibold">OVERDUE</span>
          )}
          <EditCorrectiveActionForm id={action.id} action={action} />
        </div>
        {action.description && (
          <p className="text-sm text-[var(--dpf-muted)]">{action.description}</p>
        )}
      </div>

      {/* Metadata grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
          <p className="text-xs text-[var(--dpf-muted)]">Source Type</p>
          <p className="text-sm font-semibold text-[var(--dpf-text)]">{action.sourceType}</p>
        </div>
        {action.dueDate && (
          <div className={`p-3 rounded-lg border ${isOverdue ? "border-red-500/50" : "border-[var(--dpf-border)]"}`}>
            <p className="text-xs text-[var(--dpf-muted)]">Due Date</p>
            <p className={`text-sm font-semibold ${isOverdue ? "text-red-400" : "text-[var(--dpf-text)]"}`}>{new Date(action.dueDate).toLocaleDateString()}</p>
          </div>
        )}
        {action.completedAt && (
          <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">Completed At</p>
            <p className="text-sm font-semibold text-[var(--dpf-text)]">{new Date(action.completedAt).toLocaleDateString()}</p>
          </div>
        )}
        {action.owner && (
          <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">Owner</p>
            <p className="text-sm font-semibold text-[var(--dpf-text)]">{action.owner.displayName}</p>
          </div>
        )}
      </div>

      {/* Root Cause */}
      {action.rootCause && (
        <div className="mb-6">
          <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-2">Root Cause</h2>
          <p className="text-sm text-[var(--dpf-text)]">{action.rootCause}</p>
        </div>
      )}

      {/* Verification */}
      {(action.verificationMethod || action.verificationDate || action.verifiedBy) && (
        <div className="mb-6">
          <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-2">Verification</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {action.verificationMethod && (
              <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
                <p className="text-xs text-[var(--dpf-muted)]">Method</p>
                <p className="text-sm font-semibold text-[var(--dpf-text)]">{action.verificationMethod}</p>
              </div>
            )}
            {action.verificationDate && (
              <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
                <p className="text-xs text-[var(--dpf-muted)]">Verification Date</p>
                <p className="text-sm font-semibold text-[var(--dpf-text)]">{new Date(action.verificationDate).toLocaleDateString()}</p>
              </div>
            )}
            {action.verifiedBy && (
              <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
                <p className="text-xs text-[var(--dpf-muted)]">Verified By</p>
                <p className="text-sm font-semibold text-[var(--dpf-text)]">{action.verifiedBy.displayName}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Linked Incident */}
      {action.incident && (
        <div className="mb-6">
          <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-2">Incident</h2>
          <Link
            href={`/compliance/incidents/${action.incident.id}`}
            className="inline-flex items-center gap-2 p-3 rounded-lg border border-[var(--dpf-border)] hover:border-[var(--dpf-accent)] transition-colors"
          >
            <span className="text-sm font-semibold text-[var(--dpf-text)]">{action.incident.title}</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">{action.incident.incidentId}</span>
            <span className="text-xs text-blue-400">View</span>
          </Link>
        </div>
      )}

      {/* Linked Audit Finding */}
      {action.auditFinding && (
        <div className="mb-6">
          <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-2">Audit Finding</h2>
          <Link
            href={`/compliance/audits/${action.auditFinding.auditId}`}
            className="inline-flex items-center gap-2 p-3 rounded-lg border border-[var(--dpf-border)] hover:border-[var(--dpf-accent)] transition-colors"
          >
            <span className="text-sm font-semibold text-[var(--dpf-text)]">{action.auditFinding.title}</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">{action.auditFinding.findingId}</span>
            <span className="text-xs text-blue-400">View</span>
          </Link>
        </div>
      )}
    </div>
  );
}
