import { prisma } from "@dpf/db";
import { CreateObligationForm } from "@/components/compliance/CreateObligationForm";
import Link from "next/link";

type Props = {
  searchParams: Promise<{ regulation?: string; category?: string; status?: string }>;
};

export default async function ObligationsPage({ searchParams }: Props) {
  const filters = await searchParams;

  const [obligations, regulations, categories] = await Promise.all([
    prisma.obligation.findMany({
      where: {
        ...(filters.regulation && { regulationId: filters.regulation }),
        ...(filters.category && { category: filters.category }),
        ...(filters.status ? { status: filters.status } : { status: "active" }),
      },
      include: {
        regulation: { select: { id: true, shortName: true, jurisdiction: true } },
        ownerEmployee: { select: { id: true, displayName: true } },
        _count: { select: { controls: true } },
      },
      orderBy: { title: "asc" },
    }),
    prisma.regulation.findMany({
      where: { status: "active" },
      select: { id: true, shortName: true },
      orderBy: { shortName: "asc" },
    }),
    prisma.obligation.findMany({
      where: { category: { not: null } },
      select: { category: true },
      distinct: ["category"],
      orderBy: { category: "asc" },
    }),
  ]);

  const distinctCategories = categories
    .map((c) => c.category)
    .filter((c): c is string => c !== null);

  // Build filter URL helper
  function filterUrl(key: string, value: string) {
    const p = new URLSearchParams();
    if (key === "regulation" && value) p.set("regulation", value);
    else if (filters.regulation) p.set("regulation", filters.regulation);

    if (key === "category" && value) p.set("category", value);
    else if (filters.category) p.set("category", filters.category);

    if (key === "status" && value) p.set("status", value);
    else if (filters.status) p.set("status", filters.status);

    const qs = p.toString();
    return `/compliance/obligations${qs ? `?${qs}` : ""}`;
  }

  const activeFilterCount =
    (filters.regulation ? 1 : 0) +
    (filters.category ? 1 : 0) +
    (filters.status ? 1 : 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Obligations</h1>
          <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
            {obligations.length} result{obligations.length !== 1 ? "s" : ""}
          </p>
        </div>
        <CreateObligationForm regulations={regulations} />
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        {/* Regulation filter */}
        <div className="flex flex-col gap-1">
          <label className="text-[9px] text-[var(--dpf-muted)] uppercase tracking-widest">Regulation</label>
          <div className="flex gap-1">
            <Link
              href={filterUrl("regulation", "")}
              className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                !filters.regulation
                  ? "border-[var(--dpf-accent)] text-white bg-[var(--dpf-accent)]/10"
                  : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:border-[var(--dpf-accent)]"
              }`}
            >
              All
            </Link>
            {regulations.map((r) => (
              <Link
                key={r.id}
                href={filterUrl("regulation", r.id)}
                className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                  filters.regulation === r.id
                    ? "border-[var(--dpf-accent)] text-white bg-[var(--dpf-accent)]/10"
                    : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:border-[var(--dpf-accent)]"
                }`}
              >
                {r.shortName}
              </Link>
            ))}
          </div>
        </div>

        {/* Category filter */}
        <div className="flex flex-col gap-1">
          <label className="text-[9px] text-[var(--dpf-muted)] uppercase tracking-widest">Category</label>
          <div className="flex gap-1 flex-wrap">
            <Link
              href={filterUrl("category", "")}
              className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                !filters.category
                  ? "border-[var(--dpf-accent)] text-white bg-[var(--dpf-accent)]/10"
                  : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:border-[var(--dpf-accent)]"
              }`}
            >
              All
            </Link>
            {distinctCategories.map((cat) => (
              <Link
                key={cat}
                href={filterUrl("category", cat)}
                className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                  filters.category === cat
                    ? "border-[var(--dpf-accent)] text-white bg-[var(--dpf-accent)]/10"
                    : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:border-[var(--dpf-accent)]"
                }`}
              >
                {cat}
              </Link>
            ))}
          </div>
        </div>

        {/* Status filter */}
        <div className="flex flex-col gap-1">
          <label className="text-[9px] text-[var(--dpf-muted)] uppercase tracking-widest">Status</label>
          <div className="flex gap-1">
            {["active", "inactive"].map((s) => (
              <Link
                key={s}
                href={filterUrl("status", s === "active" && !filters.status ? "" : s)}
                className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                  (s === "active" && !filters.status) || filters.status === s
                    ? "border-[var(--dpf-accent)] text-white bg-[var(--dpf-accent)]/10"
                    : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:border-[var(--dpf-accent)]"
                }`}
              >
                {s}
              </Link>
            ))}
          </div>
        </div>

        {/* Clear all filters */}
        {activeFilterCount > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-[9px] text-transparent uppercase tracking-widest">&nbsp;</span>
            <Link
              href="/compliance/obligations"
              className="text-[10px] px-2 py-1 rounded border border-[var(--dpf-border)] text-red-400 hover:border-red-400 transition-colors"
            >
              Clear filters
            </Link>
          </div>
        )}
      </div>

      {obligations.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)]">No obligations match the current filters.</p>
      ) : (
        <div className="space-y-2">
          {obligations.map((o) => {
            const coverage = o._count.controls > 0 ? "bg-green-400" : "bg-red-400";
            return (
              <Link
                key={o.id}
                href={`/compliance/obligations/${o.id}`}
                className="block p-3 rounded-lg border border-[var(--dpf-border)] hover:border-[var(--dpf-accent)] transition-colors"
              >
                <div className="flex items-start justify-between">
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
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
