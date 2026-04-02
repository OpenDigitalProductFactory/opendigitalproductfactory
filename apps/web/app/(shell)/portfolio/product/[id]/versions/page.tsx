// apps/web/app/(shell)/portfolio/product/[id]/versions/page.tsx
//
// Versions tab — version history for this digital product.

import { prisma } from "@dpf/db";
import { notFound } from "next/navigation";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function ProductVersionsPage({ params }: Props) {
  const { id } = await params;

  const [product, versions] = await Promise.all([
    prisma.digitalProduct.findUnique({ where: { id }, select: { id: true } }),
    prisma.productVersion.findMany({
      where: { digitalProductId: id },
      orderBy: { shippedAt: "desc" },
      select: {
        id: true,
        version: true,
        gitTag: true,
        gitCommitHash: true,
        shippedBy: true,
        shippedAt: true,
        changeCount: true,
        changeSummary: true,
      },
    }),
  ]);

  if (!product) notFound();

  if (versions.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-[var(--dpf-muted)]">
          No versions recorded for this product yet.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="text-xs text-[var(--dpf-muted)] mb-4">{versions.length} versions</div>

      <div className="flex flex-col gap-2">
        {versions.map((v, i) => (
          <div
            key={v.id}
            className="flex items-start gap-4 p-4 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]"
          >
            <div className="flex-shrink-0">
              <span className={`text-sm font-bold ${i === 0 ? "text-[var(--dpf-accent)]" : "text-[var(--dpf-text)]"}`}>
                v{v.version}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              {v.changeSummary && (
                <p className="text-xs text-[var(--dpf-text)] mb-1">{v.changeSummary}</p>
              )}
              <div className="flex gap-3 text-[10px] text-[var(--dpf-muted)]">
                <span className="font-mono">{v.gitTag}</span>
                <span>Shipped {v.shippedAt.toLocaleDateString()}</span>
                {v.changeCount > 0 && <span>{v.changeCount} changes</span>}
                <span>by {v.shippedBy}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
