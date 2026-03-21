import { prisma } from "@dpf/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { transitionPolicyStatus } from "@/lib/actions/policy";
import { EditPolicyForm } from "@/components/compliance/EditPolicyForm";

type Props = { params: Promise<{ id: string }> };

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-900/30 text-gray-400",
  "in-review": "bg-yellow-900/30 text-yellow-400",
  approved: "bg-blue-900/30 text-blue-400",
  published: "bg-green-900/30 text-green-400",
  retired: "bg-gray-900/30 text-gray-400",
};

const VALID_TRANSITIONS: Record<string, string[]> = {
  "draft":     ["in-review"],
  "in-review": ["approved", "draft"],
  "approved":  ["published"],
  "published": ["retired"],
  "retired":   ["draft"],
};

const TRANSITION_LABELS: Record<string, string> = {
  "in-review": "Submit for Review",
  approved: "Approve",
  published: "Publish",
  retired: "Retire",
  draft: "Return to Draft",
};

const TRANSITION_STYLES: Record<string, string> = {
  "in-review": "bg-[var(--dpf-accent)] text-white hover:opacity-90",
  approved: "bg-[var(--dpf-accent)] text-white hover:opacity-90",
  published: "bg-green-700 text-white hover:bg-green-600",
  retired: "bg-red-700 text-white hover:bg-red-600",
  draft: "bg-gray-700 text-gray-200 hover:bg-gray-600",
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
  const availableTransitions = VALID_TRANSITIONS[policy.lifecycleStatus] ?? [];

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-2">
        <Link href="/compliance/policies" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">Policies</Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">{policy.title}</span>
      </div>

      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-xl font-bold text-[var(--dpf-text)]">{policy.title}</h1>
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${STATUS_COLORS[policy.lifecycleStatus] ?? "bg-gray-900/30 text-gray-400"}`}>
            {policy.lifecycleStatus}
          </span>
          <EditPolicyForm id={policy.id} policy={policy} />
        </div>
        {policy.description && <p className="text-sm text-[var(--dpf-muted)]">{policy.description}</p>}
      </div>

      {/* Policy Document Body */}
      {policy.body && (
        <div className="mb-6 p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-3">Policy Document</h2>
          <div className="text-sm text-[var(--dpf-text)] whitespace-pre-wrap leading-relaxed">{policy.body}</div>
        </div>
      )}

      {/* Lifecycle Transitions */}
      {availableTransitions.length > 0 && (
        <div className="flex items-center gap-2 mb-6">
          <span className="text-xs text-[var(--dpf-muted)] mr-1">Transition:</span>
          {availableTransitions.map((target) => (
            <form key={target} action={async () => { "use server"; await transitionPolicyStatus(id, target); }}>
              <button type="submit"
                className={`px-3 py-1.5 text-xs font-medium rounded ${TRANSITION_STYLES[target] ?? "bg-[var(--dpf-accent)] text-white hover:opacity-90"}`}>
                {TRANSITION_LABELS[target] ?? target}
              </button>
            </form>
          ))}
        </div>
      )}

      {/* Metadata */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
          <p className="text-xs text-[var(--dpf-muted)]">Category</p>
          <p className="text-sm font-semibold text-[var(--dpf-text)]">{policy.category}</p>
        </div>
        <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
          <p className="text-xs text-[var(--dpf-muted)]">Version</p>
          <p className="text-sm font-semibold text-[var(--dpf-text)]">{policy.version}</p>
        </div>
        {policy.ownerEmployee && (
          <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">Owner</p>
            <p className="text-sm font-semibold text-[var(--dpf-text)]">{policy.ownerEmployee.displayName}</p>
          </div>
        )}
        {policy.approvedBy && (
          <div className="p-3 rounded-lg border border-[var(--dpf-border)]">
            <p className="text-xs text-[var(--dpf-muted)]">Approved By</p>
            <p className="text-sm font-semibold text-[var(--dpf-text)]">{policy.approvedBy.displayName}</p>
          </div>
        )}
      </div>

      {/* Obligation link */}
      {policy.obligation ? (
        <p className="text-xs text-blue-400 mb-6">
          Linked to obligation: <a href={`/compliance/obligations/${policy.obligation.id}`} className="underline">{policy.obligation.title}</a>
        </p>
      ) : (
        <p className="text-xs text-[var(--dpf-muted)] mb-6">Not linked to a regulation or standard.</p>
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
                <span className="text-sm text-[var(--dpf-text)]">{r.title}</span>
                <div className="flex gap-2 mt-1">
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">{r.requirementType}</span>
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
              <span className="text-[var(--dpf-text)]">{a.employeeProfile.displayName}</span>
              <span className="text-[var(--dpf-muted)]">v{a.policyVersion} — {new Date(a.acknowledgedAt).toLocaleDateString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
