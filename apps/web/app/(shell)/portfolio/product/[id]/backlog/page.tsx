// apps/web/app/(shell)/portfolio/product/[id]/backlog/page.tsx
//
// Backlog tab — backlog items and epics scoped to this digital product.

import { prisma } from "@dpf/db";
import { notFound } from "next/navigation";
import Link from "next/link";

type Props = {
  params: Promise<{ id: string }>;
};

const STATUS_COLOURS: Record<string, string> = {
  open: "#60a5fa",
  "in-progress": "#fbbf24",
  done: "#4ade80",
  deferred: "#8888a0",
};

export default async function ProductBacklogPage({ params }: Props) {
  const { id } = await params;

  const [product, items, epics] = await Promise.all([
    prisma.digitalProduct.findUnique({ where: { id }, select: { id: true } }),
    prisma.backlogItem.findMany({
      where: { digitalProductId: id },
      orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        itemId: true,
        title: true,
        status: true,
        type: true,
        priority: true,
        createdAt: true,
        epicId: true,
        epic: { select: { epicId: true, title: true } },
      },
    }),
    prisma.epic.findMany({
      where: { items: { some: { digitalProductId: id } } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        epicId: true,
        title: true,
        status: true,
        _count: { select: { items: true } },
      },
    }),
  ]);

  if (!product) notFound();

  const openItems = items.filter((i) => i.status !== "done");
  const doneItems = items.filter((i) => i.status === "done");

  return (
    <div>
      {/* Summary */}
      <div className="flex gap-4 mb-4 text-xs text-[var(--dpf-muted)]">
        <span>{items.length} total items</span>
        <span>{openItems.length} open</span>
        <span>{doneItems.length} done</span>
        <span>{epics.length} epics</span>
      </div>

      {/* Epics */}
      {epics.length > 0 && (
        <div className="mb-6">
          <h3 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-wide mb-2">
            Epics
          </h3>
          <div className="flex flex-col gap-2">
            {epics.map((e) => {
              const colour = STATUS_COLOURS[e.status] ?? "#8888a0";
              return (
                <div
                  key={e.id}
                  className="flex items-center gap-3 p-3 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]"
                >
                  <span
                    className="text-[9px] px-1.5 py-0.5 rounded-full"
                    style={{ background: `${colour}20`, color: colour }}
                  >
                    {e.status}
                  </span>
                  <span className="text-[10px] text-[var(--dpf-muted)] font-mono">{e.epicId}</span>
                  <span className="text-xs text-[var(--dpf-text)] flex-1">{e.title}</span>
                  <span className="text-[10px] text-[var(--dpf-muted)]">
                    {e._count.items} items
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Backlog items */}
      <h3 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-wide mb-2">
        Items
      </h3>
      {openItems.length === 0 && doneItems.length === 0 ? (
        <div className="text-center py-12 text-sm text-[var(--dpf-muted)]">
          No backlog items attributed to this product yet.
          <br />
          <Link href="/ops" className="text-[var(--dpf-accent)] text-xs mt-2 inline-block">
            View cross-cutting backlog
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {[...openItems, ...doneItems].map((item) => {
            const colour = STATUS_COLOURS[item.status] ?? "#8888a0";
            return (
              <div
                key={item.id}
                className="flex items-center gap-3 px-3 py-2 rounded bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]"
              >
                {item.priority != null && (
                  <span className="text-[10px] text-[var(--dpf-muted)] font-mono w-4 text-right">
                    {item.priority}
                  </span>
                )}
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded-full"
                  style={{ background: `${colour}20`, color: colour }}
                >
                  {item.status}
                </span>
                <span className="text-[10px] text-[var(--dpf-muted)] font-mono">{item.itemId}</span>
                <span className="text-xs text-[var(--dpf-text)] flex-1">{item.title}</span>
                <span className="text-[9px] text-[var(--dpf-muted)] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)]">
                  {item.type}
                </span>
                {item.epic && (
                  <span className="text-[9px] text-[var(--dpf-muted)]">{item.epic.epicId}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
