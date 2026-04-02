// apps/web/app/(shell)/portfolio/product/[id]/architecture/page.tsx
//
// Architecture tab — EA elements attributed to this digital product.

import { prisma } from "@dpf/db";
import { notFound } from "next/navigation";
import Link from "next/link";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function ProductArchitecturePage({ params }: Props) {
  const { id } = await params;

  const [product, elements] = await Promise.all([
    prisma.digitalProduct.findUnique({ where: { id }, select: { id: true } }),
    prisma.eaElement.findMany({
      where: { digitalProductId: id },
      orderBy: [{ elementType: { domain: "asc" } }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        description: true,
        lifecycleStage: true,
        lifecycleStatus: true,
        elementType: { select: { name: true, domain: true, slug: true } },
      },
    }),
  ]);

  if (!product) notFound();

  if (elements.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-[var(--dpf-muted)] mb-2">
          No architecture elements attributed to this product yet.
        </p>
        <p className="text-xs text-[var(--dpf-muted)]">
          Elements are created in the{" "}
          <Link href="/ea" className="text-[var(--dpf-accent)]">EA Modeler</Link>{" "}
          and attributed to products.
        </p>
      </div>
    );
  }

  // Group by domain
  const groups = new Map<string, typeof elements>();
  for (const e of elements) {
    const key = e.elementType.domain ?? "Other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }

  return (
    <div>
      <div className="text-xs text-[var(--dpf-muted)] mb-4">{elements.length} elements</div>

      {[...groups.entries()].map(([domain, items]) => (
        <div key={domain} className="mb-6">
          <h3 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-wide mb-2">
            {domain}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {items.map((e) => (
              <div
                key={e.id}
                className="p-3 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-[var(--dpf-text)] font-medium">{e.name}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">
                    {e.elementType.name}
                  </span>
                </div>
                <div className="flex gap-2 text-[10px] text-[var(--dpf-muted)] mb-1">
                  <span>{e.lifecycleStage}</span>
                  <span>{e.lifecycleStatus}</span>
                </div>
                {e.description && (
                  <p className="text-[11px] text-[var(--dpf-muted)] line-clamp-2">
                    {e.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
