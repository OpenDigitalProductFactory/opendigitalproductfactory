// apps/web/app/(shell)/ops/page.tsx
import { prisma } from "@dpf/db";

const TYPE_LABELS: Record<string, string> = {
  product:   "Product Backlog",
  portfolio: "Portfolio Backlog",
};

export default async function OpsPage() {
  const items = await prisma.backlogItem.findMany({
    orderBy: [{ type: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      itemId: true,
      title: true,
      status: true,
      type: true,
    },
  });

  const types = ["product", "portfolio"] as const;
  const byType = new Map(types.map((t) => [t, items.filter((i) => i.type === t)]));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Operations</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          {items.length} item{items.length !== 1 ? "s" : ""}
        </p>
      </div>

      {types.map((t) => {
        const typeItems = byType.get(t) ?? [];
        if (typeItems.length === 0) return null;

        const typeLabel = TYPE_LABELS[t] ?? t;

        return (
          <section key={t} className="mb-8">
            <h2 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-widest mb-3">
              {typeLabel}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {typeItems.map((item) => (
                <div
                  key={item.id}
                  className="p-4 rounded-lg bg-[var(--dpf-surface-1)] border-l-4"
                  style={{ borderLeftColor: "#38bdf8" }}
                >
                  <p className="text-[9px] font-mono text-[var(--dpf-muted)] mb-1">
                    {item.itemId}
                  </p>
                  <p className="text-sm font-semibold text-white leading-tight mb-1">
                    {item.title}
                  </p>
                  <p className="text-[9px] text-[var(--dpf-muted)]">{item.status}</p>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {items.length === 0 && (
        <p className="text-sm text-[var(--dpf-muted)]">No backlog items yet.</p>
      )}
    </div>
  );
}
