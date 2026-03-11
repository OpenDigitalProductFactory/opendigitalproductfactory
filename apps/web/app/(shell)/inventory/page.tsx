// apps/web/app/(shell)/inventory/page.tsx
import Link from "next/link";
import { prisma } from "@dpf/db";
import { PORTFOLIO_COLOURS } from "@/lib/portfolio";

const STATUS_COLOURS: Record<string, string> = {
  active: "#4ade80",   // green-400
  planned: "#fbbf24",  // amber-400
};

export default async function InventoryPage() {
  const products = await prisma.digitalProduct.findMany({
    orderBy: [{ portfolio: { name: "asc" } }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      status: true,
      portfolio: { select: { slug: true, name: true } },
      taxonomyNode: { select: { nodeId: true } },
    },
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Inventory</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          {products.length} product{products.length !== 1 ? "s" : ""}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {products.map((p) => {
          const colour = p.portfolio ? (PORTFOLIO_COLOURS[p.portfolio.slug] ?? "#7c8cf8") : "#555566";
          const statusColour = STATUS_COLOURS[p.status] ?? "#555566";
          const href = p.taxonomyNode
            ? `/portfolio/${p.taxonomyNode.nodeId}`
            : p.portfolio
            ? `/portfolio/${p.portfolio.slug}`
            : null;
          const taxonomyPath = p.taxonomyNode
            ? p.taxonomyNode.nodeId.replace(/\//g, " / ")
            : null;

          const card = (
            <div
              className="p-4 rounded-lg bg-[var(--dpf-surface-1)] border-l-4"
              style={{ borderLeftColor: colour }}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <p className="text-sm font-semibold text-white leading-tight">{p.name}</p>
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0"
                  style={{ background: `${statusColour}20`, color: statusColour }}
                >
                  {p.status}
                </span>
              </div>
              {p.portfolio && (
                <p className="text-[10px] font-medium mb-0.5" style={{ color: colour }}>
                  {p.portfolio.name}
                </p>
              )}
              {taxonomyPath && (
                <p className="text-[9px] text-[var(--dpf-muted)] font-mono">{taxonomyPath}</p>
              )}
            </div>
          );

          return href ? (
            <Link
              key={p.id}
              href={href}
              className="block hover:opacity-80 transition-opacity"
            >
              {card}
            </Link>
          ) : (
            <div key={p.id}>{card}</div>
          );
        })}
      </div>

      {products.length === 0 && (
        <p className="text-sm text-[var(--dpf-muted)]">No products registered yet.</p>
      )}
    </div>
  );
}
