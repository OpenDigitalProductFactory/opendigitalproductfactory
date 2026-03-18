import { prisma } from "@dpf/db";

export default async function ObligationsPage() {
  const obligations = await prisma.obligation.findMany({
    where: { status: "active" },
    include: {
      regulation: { select: { shortName: true, jurisdiction: true } },
      ownerEmployee: { select: { id: true, displayName: true } },
      _count: { select: { controls: true } },
    },
    orderBy: { title: "asc" },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Obligations</h1>
          <p className="text-sm text-[var(--dpf-muted)] mt-0.5">{obligations.length} active</p>
        </div>
      </div>

      {obligations.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)]">No obligations defined yet.</p>
      ) : (
        <div className="space-y-2">
          {obligations.map((o) => {
            const coverage = o._count.controls > 0 ? "bg-green-400" : "bg-red-400";
            return (
              <div key={o.id} className="p-3 rounded-lg border border-[var(--dpf-border)] flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${coverage}`} />
                    <span className="text-sm text-white">{o.title}</span>
                  </div>
                  <div className="flex gap-2 mt-1">
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#333] text-[var(--dpf-muted)]">{o.regulation.shortName}</span>
                    {o.category && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#333] text-[var(--dpf-muted)]">{o.category}</span>}
                  </div>
                </div>
                <div className="text-right text-xs text-[var(--dpf-muted)]">
                  <p>{o._count.controls} control{o._count.controls !== 1 ? "s" : ""}</p>
                  {o.ownerEmployee && <p>{o.ownerEmployee.displayName}</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
