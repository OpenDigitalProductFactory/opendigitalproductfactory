// apps/web/app/(shell)/inventory/page.tsx
import { prisma } from "@dpf/db";
import { InventoryClient } from "@/components/inventory/InventoryClient";

const DEFAULT_PAGE_SIZE = 10_000;

export default async function InventoryPage() {
  const [items, total] = await Promise.all([
    prisma.digitalProduct.findMany({
      take: DEFAULT_PAGE_SIZE,
      orderBy: [{ portfolio: { name: "asc" } }, { name: "asc" }],
      select: {
        id: true,
        productId: true,
        name: true,
        lifecycleStatus: true,
        portfolio: { select: { slug: true, name: true } },
      },
    }),
    prisma.digitalProduct.count(),
  ]);

  return (
    <div className="flex flex-col h-full">
      <div className="mb-4 shrink-0">
        <h1 className="text-xl font-bold text-white">Inventory</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          {total.toLocaleString()} product{total !== 1 ? "s" : ""}
        </p>
      </div>
      <div className="flex-1">
        <InventoryClient initial={items} initialTotal={total} />
      </div>
    </div>
  );
}
