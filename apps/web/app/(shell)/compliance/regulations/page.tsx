import { prisma } from "@dpf/db";
import { CreateRegulationForm } from "@/components/compliance/CreateRegulationForm";

export default async function RegulationsPage() {
  const regulations = await prisma.regulation.findMany({
    orderBy: { shortName: "asc" },
    include: { _count: { select: { obligations: true } } },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-[var(--dpf-text)]">Regulations</h1>
          <p className="text-sm text-[var(--dpf-muted)] mt-0.5">{regulations.length} registered</p>
        </div>
        <CreateRegulationForm />
      </div>

      {regulations.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)]">No regulations registered yet.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {regulations.map((r) => (
            <a key={r.id} href={`/compliance/regulations/${r.id}`}
              className="block p-4 rounded-lg border border-[var(--dpf-border)] hover:border-[var(--dpf-accent)] transition-colors">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-semibold text-[var(--dpf-text)]">{r.shortName}</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">{r.jurisdiction}</span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${r.status === "active" ? "bg-green-900/30 text-green-400" : "bg-red-900/30 text-red-400"}`}>
                  {r.status}
                </span>
              </div>
              <p className="text-xs text-[var(--dpf-muted)] mb-1">{r.name}</p>
              <p className="text-xs text-[var(--dpf-muted)]">
                {r._count.obligations} obligation{r._count.obligations !== 1 ? "s" : ""}
              </p>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
