import { prisma } from "@dpf/db";
import { notFound } from "next/navigation";

type Props = { params: Promise<{ id: string }> };

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-900/30 text-gray-400",
  "in-review": "bg-yellow-900/30 text-yellow-400",
  approved: "bg-blue-900/30 text-blue-400",
  published: "bg-green-900/30 text-green-400",
  retired: "bg-gray-900/30 text-gray-400",
};

export default async function PolicyDetailPage({ params }: Props) {
  const { id } = await params;
  const policy = await prisma.policy.findUnique({
    where: { id },
    include: {
      ownerEmployee: { select: { displayName: true } },
      approvedBy: { select: { displayName: true } },
      obligation: { select: { id: true, title: true } },
      requirements: {
        where: { status: "active" },
        include: {
          trainingRequirement: true,
          _count: { select: { completions: { where: { status: "active" } } } },
        },
        orderBy: { createdAt: "asc" },
      },
      acknowledgments: {
        include: { employeeProfile: { select: { id: true, displayName: true } } },
        orderBy: { acknowledgedAt: "desc" },
      },
    },
  });
  if (!policy) notFound();

  const totalEmployees = await prisma.employeeProfile.count({ where: { status: "active" } });

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-xl font-bold text-white">{policy.title}</h1>
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${STATUS_COLORS[policy.lifecycleStatus] ?? "bg-gray-900/30 text-gray-400"}`}>
            {policy.lifecycleStatus}
          </span>
        </div>
        {policy.description && <p className="text-sm text-[var(--dpf-muted)]">{policy.description}</p>}
      </div>

      {/* Metadata */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
          <p className="text-xs text-[var(--dpf-muted)]">Category</p>
          <p className="text-sm font-semibold text-white">{policy.category}</p>
        </div>
        <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
          <p className="text-xs text-[var(--dpf-muted)]">Version</p>
          <p className="text-sm font-semibold text-white">{policy.version}</p>
        </div>
        {policy.ownerEmployee && (
          <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">Owner</p>
            <p className="text-sm font-semibold text-white">{policy.ownerEmployee.displayName}</p>
          </div>
        )}
        {policy.approvedBy && (
          <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">Approved By</p>
            <p className="text-sm font-semibold text-white">{policy.approvedBy.displayName}</p>
          </div>
        )}
      </div>

      {/* Obligation link */}
      {policy.obligation ? (
        <p className="text-xs text-blue-400 mb-6">
          Linked to obligation: <a href={`/compliance/obligations`} className="underline">{policy.obligation.title}</a>
        </p>
      ) : (
        <p className="text-xs text-[var(--dpf-muted)] mb-6">Not linked to a regulation.</p>
      )}

      {/* Requirements */}
      <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-3">
        Requirements ({policy.requirements.length})
      </h2>
      {policy.requirements.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)] mb-6">No requirements defined.</p>
      ) : (
        <div className="space-y-2 mb-6">
          {policy.requirements.map((r) => (
            <div key={r.id} className="p-3 rounded-lg border border-[var(--dpf-border)] flex items-start justify-between">
              <div>
                <span className="text-sm text-white">{r.title}</span>
                <div className="flex gap-2 mt-1">
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#333] text-[var(--dpf-muted)]">{r.requirementType}</span>
                  {r.frequency && <span className="text-[9px] text-[var(--dpf-muted)]">{r.frequency}</span>}
                  {r.trainingRequirement && (
                    <span className="text-[9px] text-[var(--dpf-muted)]">
                      {r.trainingRequirement.trainingTitle}
                      {r.trainingRequirement.durationMinutes && ` (${r.trainingRequirement.durationMinutes}min)`}
                    </span>
                  )}
                </div>
              </div>
              <span className="text-xs text-[var(--dpf-muted)]">
                {r._count.completions}/{totalEmployees} completed
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Acknowledgments */}
      <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-3">
        Acknowledgments ({policy.acknowledgments.length}/{totalEmployees})
      </h2>
      {policy.acknowledgments.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)]">No acknowledgments yet.</p>
      ) : (
        <div className="space-y-1">
          {policy.acknowledgments.map((a) => (
            <div key={a.id} className="flex justify-between text-sm">
              <span className="text-white">{a.employeeProfile.displayName}</span>
              <span className="text-[var(--dpf-muted)]">v{a.policyVersion} — {new Date(a.acknowledgedAt).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
