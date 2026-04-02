// apps/web/app/(shell)/portfolio/product/[id]/inventory/page.tsx
//
// Inventory tab — discovered infrastructure and software entities for this product.

import { prisma } from "@dpf/db";
import { notFound } from "next/navigation";
import Link from "next/link";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function ProductInventoryPage({ params }: Props) {
  const { id } = await params;

  const [product, entities] = await Promise.all([
    prisma.digitalProduct.findUnique({ where: { id }, select: { id: true } }),
    prisma.inventoryEntity.findMany({
      where: { digitalProductId: id },
      orderBy: [{ providerView: "asc" }, { name: "asc" }],
      select: {
        id: true,
        entityKey: true,
        name: true,
        entityType: true,
        providerView: true,
        status: true,
        taxonomyNode: { select: { name: true } },
      },
    }),
  ]);

  if (!product) notFound();

  if (entities.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-[var(--dpf-muted)] mb-2">
          No inventory entities attributed to this product yet.
        </p>
        <p className="text-xs text-[var(--dpf-muted)]">
          Entities are attributed during{" "}
          <Link href="/inventory" className="text-[var(--dpf-accent)]">discovery runs</Link>.
        </p>
      </div>
    );
  }

  // Group by providerView
  const groups = new Map<string, typeof entities>();
  for (const e of entities) {
    const key = e.providerView ?? "Other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }

  return (
    <div>
      <div className="text-xs text-[var(--dpf-muted)] mb-4">{entities.length} entities</div>

      {[...groups.entries()].map(([view, items]) => (
        <div key={view} className="mb-6">
          <h3 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-wide mb-2">
            {view}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {items.map((e) => (
              <div
                key={e.id}
                className="p-3 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-[var(--dpf-text)] font-medium">{e.name}</span>
                  {e.status && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">
                      {e.status}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-[var(--dpf-muted)] font-mono">{e.entityKey}</div>
                <div className="flex gap-2 mt-1.5">
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">
                    {e.entityType}
                  </span>
                  {e.taxonomyNode && (
                    <span className="text-[9px] text-[var(--dpf-muted)]">
                      {e.taxonomyNode.name}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
