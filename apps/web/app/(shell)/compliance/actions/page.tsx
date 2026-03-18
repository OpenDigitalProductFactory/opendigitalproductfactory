import { prisma } from "@dpf/db";

export default async function ActionsPage() {
  const actions = await prisma.correctiveAction.findMany({
    include: {
      owner: { select: { id: true, displayName: true } },
      incident: { select: { id: true, title: true } },
      auditFinding: { select: { id: true, title: true } },
    },
    orderBy: { dueDate: "asc" },
  });

  const now = new Date();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Corrective Actions</h1>
          <p className="text-sm text-[var(--dpf-muted)] mt-0.5">{actions.length} total</p>
        </div>
      </div>

      {actions.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)]">No corrective actions yet.</p>
      ) : (
        <div className="space-y-2">
          {actions.map((a) => {
            const isOverdue = a.dueDate && a.dueDate < now && !["completed", "verified"].includes(a.status);
            return (
              <div key={a.id} className={`p-3 rounded-lg border ${isOverdue ? "border-red-500/50" : "border-[var(--dpf-border)]"} flex items-start justify-between`}>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-white">{a.title}</span>
                    {isOverdue && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-900/30 text-red-400 font-semibold">OVERDUE</span>
                    )}
                  </div>
                  <div className="flex gap-2 mt-1">
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#333] text-[var(--dpf-muted)]">{a.sourceType}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                      a.status === "verified" ? "bg-green-900/30 text-green-400" :
                      a.status === "completed" ? "bg-blue-900/30 text-blue-400" :
                      a.status === "open" ? "bg-yellow-900/30 text-yellow-400" :
                      "bg-gray-900/30 text-gray-400"
                    }`}>
                      {a.status}
                    </span>
                    {a.incident && <span className="text-[9px] text-[var(--dpf-muted)]">← {a.incident.title}</span>}
                    {a.auditFinding && <span className="text-[9px] text-[var(--dpf-muted)]">← {a.auditFinding.title}</span>}
                  </div>
                </div>
                <div className="text-right text-xs text-[var(--dpf-muted)]">
                  {a.dueDate && <p className={isOverdue ? "text-red-400" : ""}>Due: {new Date(a.dueDate).toLocaleDateString()}</p>}
                  {a.owner && <p>{a.owner.displayName}</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
