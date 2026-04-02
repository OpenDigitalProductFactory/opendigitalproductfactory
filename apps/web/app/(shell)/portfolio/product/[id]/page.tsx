// apps/web/app/(shell)/portfolio/product/[id]/page.tsx
//
// Overview tab — product metadata summary, stats, and quick links to other tabs.

import { prisma } from "@dpf/db";
import { notFound } from "next/navigation";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function ProductOverviewPage({ params }: Props) {
  const { id } = await params;

  const product = await prisma.digitalProduct.findUnique({
    where: { id },
    select: {
      id: true,
      productId: true,
      name: true,
      createdAt: true,
      updatedAt: true,
      lifecycleStage: true,
      lifecycleStatus: true,
      version: true,
      portfolio: { select: { name: true } },
      taxonomyNode: { select: { name: true } },
      _count: {
        select: {
          backlogItems: true,
          inventoryEntities: true,
          eaElements: true,
          versions: true,
          serviceOfferings: true,
          featureBuilds: true,
          businessModels: true,
        },
      },
    },
  });

  if (!product) notFound();

  const stats = [
    { label: "Backlog Items", value: product._count.backlogItems, href: `/portfolio/product/${id}/backlog` },
    { label: "Inventory Entities", value: product._count.inventoryEntities, href: `/portfolio/product/${id}/inventory` },
    { label: "Architecture Elements", value: product._count.eaElements, href: `/portfolio/product/${id}/architecture` },
    { label: "Versions", value: product._count.versions, href: `/portfolio/product/${id}/versions` },
    { label: "Service Offerings", value: product._count.serviceOfferings, href: `/portfolio/product/${id}/offerings` },
    { label: "Feature Builds", value: product._count.featureBuilds, href: `/portfolio/product/${id}/changes` },
    { label: "Business Models", value: product._count.businessModels, href: `/portfolio/product/${id}/team` },
  ];

  return (
    <div>
      {/* Stats strip */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {stats.map((s) => (
          <a
            key={s.label}
            href={s.href}
            className="bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] rounded-lg p-4 no-underline hover:border-[var(--dpf-accent)] transition-colors"
          >
            <div className="text-2xl font-bold text-[var(--dpf-text)]">{s.value}</div>
            <div className="text-[11px] text-[var(--dpf-muted)] mt-1">{s.label}</div>
          </a>
        ))}
      </div>

      {/* Metadata */}
      <div className="bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] rounded-lg p-5">
        <h2 className="text-sm font-semibold text-[var(--dpf-text)] mb-3">Product Details</h2>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-xs">
          <div>
            <dt className="text-[var(--dpf-muted)]">Product ID</dt>
            <dd className="text-[var(--dpf-text)] mt-0.5">{product.productId}</dd>
          </div>
          <div>
            <dt className="text-[var(--dpf-muted)]">Lifecycle Stage</dt>
            <dd className="text-[var(--dpf-text)] mt-0.5">{product.lifecycleStage}</dd>
          </div>
          <div>
            <dt className="text-[var(--dpf-muted)]">Version</dt>
            <dd className="text-[var(--dpf-text)] mt-0.5">v{product.version}</dd>
          </div>
          <div>
            <dt className="text-[var(--dpf-muted)]">Portfolio</dt>
            <dd className="text-[var(--dpf-text)] mt-0.5">{product.portfolio?.name ?? "Unassigned"}</dd>
          </div>
          <div>
            <dt className="text-[var(--dpf-muted)]">Taxonomy</dt>
            <dd className="text-[var(--dpf-text)] mt-0.5">{product.taxonomyNode?.name ?? "Unattributed"}</dd>
          </div>
          <div>
            <dt className="text-[var(--dpf-muted)]">Created</dt>
            <dd className="text-[var(--dpf-text)] mt-0.5">{product.createdAt.toLocaleDateString()}</dd>
          </div>
          <div>
            <dt className="text-[var(--dpf-muted)]">Last Updated</dt>
            <dd className="text-[var(--dpf-text)] mt-0.5">{product.updatedAt.toLocaleDateString()}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
