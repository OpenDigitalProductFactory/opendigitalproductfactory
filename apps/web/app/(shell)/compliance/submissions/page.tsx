import { listSubmissions } from "@/lib/actions/compliance";
import { SUBMISSION_STATUSES, SUBMISSION_TYPES } from "@/lib/compliance-types";
import Link from "next/link";
import { prisma } from "@dpf/db";
import { CreateSubmissionForm } from "@/components/compliance/CreateSubmissionForm";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-900/30 text-gray-400",
  pending: "bg-yellow-900/30 text-yellow-400",
  submitted: "bg-blue-900/30 text-blue-400",
  acknowledged: "bg-green-900/30 text-green-400",
  rejected: "bg-red-900/30 text-red-400",
};

type Props = { searchParams: Promise<{ status?: string; submissionType?: string }> };

export default async function SubmissionsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const filters = {
    ...(sp.status && { status: sp.status }),
    ...(sp.submissionType && { submissionType: sp.submissionType }),
  };
  const hasFilters = Object.keys(filters).length > 0;
  const [submissions, regulations] = await Promise.all([
    listSubmissions(hasFilters ? filters : undefined),
    prisma.regulation.findMany({ where: { status: "active" }, select: { id: true, shortName: true }, orderBy: { shortName: "asc" } }),
  ]);

  const now = new Date();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Regulatory Submissions</h1>
          <p className="text-sm text-[var(--dpf-muted)] mt-0.5">{submissions.length} total</p>
        </div>
        <CreateSubmissionForm regulations={regulations} />
      </div>

      {/* Filter bar */}
      <form className="flex flex-wrap gap-3 mb-6">
        <select name="status" defaultValue={sp.status ?? ""}
          className="text-xs px-2 py-1.5 rounded-md border border-[var(--dpf-border)] bg-[#1a1a1a] text-white focus:outline-none focus:border-[var(--dpf-accent)]">
          <option value="">All statuses</option>
          {SUBMISSION_STATUSES.map((s) => (
            <option key={s} value={s}>{s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</option>
          ))}
        </select>

        <select name="submissionType" defaultValue={sp.submissionType ?? ""}
          className="text-xs px-2 py-1.5 rounded-md border border-[var(--dpf-border)] bg-[#1a1a1a] text-white focus:outline-none focus:border-[var(--dpf-accent)]">
          <option value="">All types</option>
          {SUBMISSION_TYPES.map((t) => (
            <option key={t} value={t}>{t.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</option>
          ))}
        </select>

        <button type="submit"
          className="text-xs px-3 py-1.5 rounded-md bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity">
          Filter
        </button>

        {hasFilters && (
          <Link href="/compliance/submissions"
            className="text-xs px-3 py-1.5 rounded-md border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-white transition-colors">
            Clear
          </Link>
        )}
      </form>

      {submissions.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)]">No submissions match the current filters.</p>
      ) : (
        <div className="space-y-2">
          {submissions.map((s) => {
            const daysRemaining = s.dueDate
              ? Math.ceil((new Date(s.dueDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
              : null;
            return (
              <a key={s.id} href={`/compliance/submissions/${s.id}`} className="block p-3 rounded-lg border border-[var(--dpf-border)] flex items-start justify-between hover:border-[var(--dpf-muted)] transition-colors">
                <div>
                  <span className="text-sm text-white">{s.title}</span>
                  <div className="flex gap-2 mt-1">
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#333] text-[var(--dpf-muted)]">{s.recipientBody}</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#333] text-[var(--dpf-muted)]">{s.submissionType}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${STATUS_COLORS[s.status] ?? "bg-gray-900/30 text-gray-400"}`}>
                      {s.status}
                    </span>
                    {s.regulation && <span className="text-[9px] text-[var(--dpf-muted)]">{s.regulation.shortName}</span>}
                  </div>
                </div>
                <div className="text-right text-xs text-[var(--dpf-muted)]">
                  {s.dueDate && (
                    <p className={daysRemaining !== null && daysRemaining < 0 ? "text-red-400" : daysRemaining !== null && daysRemaining < 7 ? "text-yellow-400" : undefined}>
                      Due: {new Date(s.dueDate).toLocaleDateString()}
                      {daysRemaining !== null && (
                        <span className="ml-1">({daysRemaining < 0 ? `${Math.abs(daysRemaining)}d overdue` : `${daysRemaining}d`})</span>
                      )}
                    </p>
                  )}
                  {s.submittedAt && <p>Submitted: {new Date(s.submittedAt).toLocaleDateString()}</p>}
                  {s.confirmationRef && <p>Ref: {s.confirmationRef}</p>}
                  {s.submittedBy && <p>{s.submittedBy.displayName}</p>}
                </div>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
