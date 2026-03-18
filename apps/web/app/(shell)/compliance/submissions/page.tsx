import { prisma } from "@dpf/db";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-900/30 text-gray-400",
  pending: "bg-yellow-900/30 text-yellow-400",
  submitted: "bg-blue-900/30 text-blue-400",
  acknowledged: "bg-green-900/30 text-green-400",
  rejected: "bg-red-900/30 text-red-400",
};

export default async function SubmissionsPage() {
  const submissions = await prisma.regulatorySubmission.findMany({
    include: {
      regulation: { select: { shortName: true } },
      submittedBy: { select: { id: true, displayName: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Regulatory Submissions</h1>
          <p className="text-sm text-[var(--dpf-muted)] mt-0.5">{submissions.length} total</p>
        </div>
      </div>

      {submissions.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)]">No regulatory submissions yet.</p>
      ) : (
        <div className="space-y-2">
          {submissions.map((s) => (
            <div key={s.id} className="p-3 rounded-lg border border-[var(--dpf-border)] flex items-start justify-between">
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
                {s.dueDate && <p>Due: {new Date(s.dueDate).toLocaleDateString()}</p>}
                {s.submittedAt && <p>Submitted: {new Date(s.submittedAt).toLocaleDateString()}</p>}
                {s.confirmationRef && <p>Ref: {s.confirmationRef}</p>}
                {s.submittedBy && <p>{s.submittedBy.displayName}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
