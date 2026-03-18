import { prisma } from "@dpf/db";

export default async function EvidencePage() {
  const evidence = await prisma.complianceEvidence.findMany({
    where: { status: "active" },
    include: {
      obligation: { select: { id: true, title: true } },
      control: { select: { id: true, title: true } },
      collectedBy: { select: { id: true, displayName: true } },
    },
    orderBy: { collectedAt: "desc" },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Evidence</h1>
          <p className="text-sm text-[var(--dpf-muted)] mt-0.5">{evidence.length} active record{evidence.length !== 1 ? "s" : ""}</p>
        </div>
      </div>

      {evidence.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)]">No evidence collected yet.</p>
      ) : (
        <div className="space-y-2">
          {evidence.map((e) => (
            <div key={e.id} className="p-3 rounded-lg border border-[var(--dpf-border)] flex items-start justify-between">
              <div>
                <span className="text-sm text-white">{e.title}</span>
                <div className="flex gap-2 mt-1">
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#333] text-[var(--dpf-muted)]">{e.evidenceType}</span>
                  {e.obligation && <span className="text-[9px] text-[var(--dpf-muted)]">→ {e.obligation.title}</span>}
                  {e.control && <span className="text-[9px] text-[var(--dpf-muted)]">→ {e.control.title}</span>}
                </div>
              </div>
              <div className="text-right text-xs text-[var(--dpf-muted)]">
                <p>{new Date(e.collectedAt).toLocaleDateString()}</p>
                {e.collectedBy && <p>{e.collectedBy.displayName}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
