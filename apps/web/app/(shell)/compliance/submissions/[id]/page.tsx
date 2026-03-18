import { notFound } from "next/navigation";
import { getSubmission } from "@/lib/actions/reporting";

type Props = { params: Promise<{ id: string }> };

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-900/30 text-gray-400",
  pending: "bg-yellow-900/30 text-yellow-400",
  submitted: "bg-blue-900/30 text-blue-400",
  acknowledged: "bg-green-900/30 text-green-400",
  rejected: "bg-red-900/30 text-red-400",
};

export default async function SubmissionDetailPage({ params }: Props) {
  const { id } = await params;
  let submission;
  try {
    submission = await getSubmission(id);
  } catch {
    notFound();
  }

  const now = new Date();
  const daysRemaining = submission.dueDate
    ? Math.ceil((new Date(submission.dueDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-xl font-bold text-white">{submission.title}</h1>
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${STATUS_COLORS[submission.status] ?? "bg-gray-900/30 text-gray-400"}`}>
            {submission.status}
          </span>
        </div>
        <p className="text-sm text-[var(--dpf-muted)]">{submission.recipientBody} · {submission.submissionType}</p>
      </div>

      {/* Metadata */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {submission.dueDate && (
          <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">Due Date</p>
            <p className={`text-sm font-semibold ${daysRemaining !== null && daysRemaining < 0 ? "text-red-400" : daysRemaining !== null && daysRemaining < 7 ? "text-yellow-400" : "text-white"}`}>
              {new Date(submission.dueDate).toLocaleDateString()}
              {daysRemaining !== null && (
                <span className="text-xs ml-1">({daysRemaining < 0 ? `${Math.abs(daysRemaining)}d overdue` : `${daysRemaining}d remaining`})</span>
              )}
            </p>
          </div>
        )}
        {submission.submittedAt && (
          <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">Submitted</p>
            <p className="text-sm font-semibold text-white">{new Date(submission.submittedAt).toLocaleDateString()}</p>
          </div>
        )}
        {submission.confirmationRef && (
          <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">Confirmation</p>
            <p className="text-sm font-semibold text-white">{submission.confirmationRef}</p>
          </div>
        )}
        {submission.submittedBy && (
          <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">Submitted By</p>
            <p className="text-sm font-semibold text-white">{submission.submittedBy.displayName}</p>
          </div>
        )}
      </div>

      {/* Regulation link */}
      {submission.regulation ? (
        <p className="text-xs text-blue-400 mb-6">
          Regulation:{" "}
          <a href={`/compliance/regulations/${submission.regulation.id}`} className="underline">
            {submission.regulation.name} ({submission.regulation.shortName})
          </a>
        </p>
      ) : (
        <p className="text-xs text-[var(--dpf-muted)] mb-6">No linked regulation.</p>
      )}

      {/* Preparation Checklist */}
      <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-3">Preparation Checklist</h2>
      {submission.checklist.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)] mb-6">No obligations to check (no linked regulation or no obligations defined).</p>
      ) : (
        <div className="space-y-2 mb-6">
          {submission.checklist.map((item: { obligationId: string; title: string; hasEvidence: boolean; evidenceCount: number }) => (
            <div key={item.obligationId} className="p-3 rounded-lg border border-[var(--dpf-border)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${item.hasEvidence ? "bg-green-400" : "bg-red-400"}`} />
                <span className="text-sm text-white">{item.title}</span>
              </div>
              <span className="text-xs text-[var(--dpf-muted)]">{item.evidenceCount} evidence record{item.evidenceCount !== 1 ? "s" : ""}</span>
            </div>
          ))}
        </div>
      )}

      {submission.notes && (
        <div className="mb-6">
          <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-2">Notes</h2>
          <p className="text-sm text-white">{submission.notes}</p>
        </div>
      )}
    </div>
  );
}
