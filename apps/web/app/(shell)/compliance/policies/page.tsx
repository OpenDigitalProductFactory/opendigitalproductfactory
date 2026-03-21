import { prisma } from "@dpf/db";
import { CreatePolicyForm } from "@/components/compliance/CreatePolicyForm";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-900/30 text-gray-400",
  "in-review": "bg-yellow-900/30 text-yellow-400",
  approved: "bg-blue-900/30 text-blue-400",
  published: "bg-green-900/30 text-green-400",
  retired: "bg-gray-900/30 text-gray-400",
};

export default async function PoliciesPage() {
  const policies = await prisma.policy.findMany({
    where: { status: "active" },
    include: {
      ownerEmployee: { select: { displayName: true } },
      obligation: { select: { title: true } },
      _count: { select: { acknowledgments: true, requirements: true } },
    },
    orderBy: { title: "asc" },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-[var(--dpf-text)]">Policies</h1>
          <p className="text-sm text-[var(--dpf-muted)] mt-0.5">{policies.length} total</p>
        </div>
        <CreatePolicyForm />
      </div>
      {policies.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)]">No policies yet. Create your first policy to get started.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {policies.map((p) => (
            <a key={p.id} href={`/compliance/policies/${p.id}`}
              className="block p-4 rounded-lg border border-[var(--dpf-border)] hover:border-[var(--dpf-accent)] transition-colors">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-semibold text-[var(--dpf-text)]">{p.title}</span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${STATUS_COLORS[p.lifecycleStatus] ?? "bg-gray-900/30 text-gray-400"}`}>
                  {p.lifecycleStatus}
                </span>
              </div>
              <div className="flex gap-2 mt-1">
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">{p.category}</span>
                <span className="text-[9px] text-[var(--dpf-muted)]">v{p.version}</span>
              </div>
              <div className="flex gap-3 mt-2 text-xs text-[var(--dpf-muted)]">
                {p.ownerEmployee && <span>{p.ownerEmployee.displayName}</span>}
                <span>{p._count.requirements} requirement{p._count.requirements !== 1 ? "s" : ""}</span>
                <span>{p._count.acknowledgments} ack{p._count.acknowledgments !== 1 ? "s" : ""}</span>
              </div>
              {p.obligation && (
                <p className="text-[9px] text-blue-400 mt-1">Linked: {p.obligation.title}</p>
              )}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
