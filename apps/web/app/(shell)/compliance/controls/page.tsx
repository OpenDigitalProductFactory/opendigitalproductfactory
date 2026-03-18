import { prisma } from "@dpf/db";

const STATUS_COLORS: Record<string, string> = {
  implemented: "bg-green-900/30 text-green-400",
  "in-progress": "bg-yellow-900/30 text-yellow-400",
  planned: "bg-blue-900/30 text-blue-400",
  "not-applicable": "bg-gray-900/30 text-gray-400",
};

export default async function ControlsPage() {
  const controls = await prisma.control.findMany({
    where: { status: "active" },
    include: {
      ownerEmployee: { select: { id: true, displayName: true } },
      _count: { select: { obligations: true } },
    },
    orderBy: { title: "asc" },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Controls</h1>
          <p className="text-sm text-[var(--dpf-muted)] mt-0.5">{controls.length} active</p>
        </div>
      </div>

      {controls.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)]">No controls defined yet.</p>
      ) : (
        <div className="space-y-2">
          {controls.map((c) => (
            <div key={c.id} className="p-3 rounded-lg border border-[var(--dpf-border)] flex items-start justify-between">
              <div>
                <span className="text-sm text-white">{c.title}</span>
                <div className="flex gap-2 mt-1">
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#333] text-[var(--dpf-muted)]">{c.controlType}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${STATUS_COLORS[c.implementationStatus] ?? "bg-gray-900/30 text-gray-400"}`}>
                    {c.implementationStatus}
                  </span>
                  {c.effectiveness && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#333] text-[var(--dpf-muted)]">{c.effectiveness}</span>
                  )}
                </div>
              </div>
              <div className="text-right text-xs text-[var(--dpf-muted)]">
                <p>{c._count.obligations} obligation{c._count.obligations !== 1 ? "s" : ""}</p>
                {c.ownerEmployee && <p>{c.ownerEmployee.displayName}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
