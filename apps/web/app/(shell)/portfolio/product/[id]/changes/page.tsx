// apps/web/app/(shell)/portfolio/product/[id]/changes/page.tsx
//
// Changes tab — change items and feature builds scoped to this product.

import { prisma } from "@dpf/db";
import { notFound } from "next/navigation";
import Link from "next/link";

type Props = {
  params: Promise<{ id: string }>;
};

const STATUS_COLOURS: Record<string, string> = {
  pending: "#60a5fa",
  "in-progress": "#fbbf24",
  completed: "#4ade80",
  rolled_back: "#f87171",
};

export default async function ProductChangesPage({ params }: Props) {
  const { id } = await params;

  const [product, changes, builds] = await Promise.all([
    prisma.digitalProduct.findUnique({ where: { id }, select: { id: true } }),
    prisma.changeItem.findMany({
      where: { digitalProductId: id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        itemType: true,
        title: true,
        status: true,
        createdAt: true,
        changeRequest: { select: { rfcId: true, title: true } },
      },
    }),
    prisma.featureBuild.findMany({
      where: { digitalProductId: id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        buildId: true,
        title: true,
        phase: true,
        createdAt: true,
      },
    }),
  ]);

  if (!product) notFound();

  const hasContent = changes.length > 0 || builds.length > 0;

  if (!hasContent) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-[var(--dpf-muted)] mb-2">
          No changes or builds recorded for this product yet.
        </p>
        <p className="text-xs text-[var(--dpf-muted)]">
          Changes appear here when RFCs reference this product.{" "}
          <Link href="/ops/changes" className="text-[var(--dpf-accent)]">
            View all changes
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Feature Builds */}
      {builds.length > 0 && (
        <div className="mb-6">
          <h3 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-wide mb-2">
            Feature Builds ({builds.length})
          </h3>
          <div className="flex flex-col gap-1.5">
            {builds.map((b) => (
              <div
                key={b.id}
                className="flex items-center gap-3 px-3 py-2 rounded bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]"
              >
                <span className="text-[10px] text-[var(--dpf-muted)] font-mono">{b.buildId}</span>
                <span className="text-xs text-[var(--dpf-text)] flex-1">{b.title}</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">
                  {b.phase}
                </span>
                <span className="text-[10px] text-[var(--dpf-muted)]">
                  {b.createdAt.toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Change Items */}
      {changes.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-wide mb-2">
            Change Records ({changes.length})
          </h3>
          <div className="flex flex-col gap-1.5">
            {changes.map((c) => {
              const colour = STATUS_COLOURS[c.status] ?? "#8888a0";
              return (
                <div
                  key={c.id}
                  className="flex items-center gap-3 px-3 py-2 rounded bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]"
                >
                  <span
                    className="text-[9px] px-1.5 py-0.5 rounded-full"
                    style={{ background: `${colour}20`, color: colour }}
                  >
                    {c.status}
                  </span>
                  <span className="text-[10px] text-[var(--dpf-muted)] font-mono">
                    {c.changeRequest.rfcId}
                  </span>
                  <span className="text-xs text-[var(--dpf-text)] flex-1">{c.title}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">
                    {c.itemType}
                  </span>
                  <span className="text-[10px] text-[var(--dpf-muted)]">
                    {c.createdAt.toLocaleDateString()}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
