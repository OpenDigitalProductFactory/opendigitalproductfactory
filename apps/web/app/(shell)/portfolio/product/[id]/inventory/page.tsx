// apps/web/app/(shell)/portfolio/product/[id]/inventory/page.tsx
//
// Inventory tab — discovered infrastructure and software entities for this product.

import { prisma } from "@dpf/db";
import { notFound } from "next/navigation";
import Link from "next/link";

import { EstateItemCard } from "@/components/inventory/EstateItemCard";
import { createEstateItem } from "@/lib/estate/estate-item";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function ProductInventoryPage({ params }: Props) {
  const { id } = await params;

  const [product, entities] = await Promise.all([
    prisma.digitalProduct.findUnique({ where: { id }, select: { id: true, name: true } }),
    prisma.inventoryEntity.findMany({
      where: { digitalProductId: id },
      orderBy: [{ providerView: "asc" }, { name: "asc" }],
      select: {
        id: true,
        entityKey: true,
        name: true,
        entityType: true,
        technicalClass: true,
        iconKey: true,
        manufacturer: true,
        productModel: true,
        observedVersion: true,
        normalizedVersion: true,
        supportStatus: true,
        providerView: true,
        status: true,
        firstSeenAt: true,
        lastSeenAt: true,
        attributionStatus: true,
        attributionConfidence: true,
        taxonomyNode: { select: { name: true, nodeId: true } },
        softwareEvidence: {
          orderBy: [{ lastSeenAt: "desc" }, { firstSeenAt: "desc" }],
          take: 3,
          select: {
            rawVendor: true,
            rawProductName: true,
            rawPackageName: true,
            rawVersion: true,
            normalizationStatus: true,
            normalizationConfidence: true,
            lastSeenAt: true,
          },
        },
        qualityIssues: {
          where: { status: "open" },
          orderBy: [{ severity: "desc" }, { lastDetectedAt: "desc" }],
          take: 8,
          select: {
            issueType: true,
            severity: true,
            status: true,
          },
        },
        _count: {
          select: {
            fromRelationships: true,
            toRelationships: true,
          },
        },
      },
    }),
  ]);

  if (!product) notFound();

  if (entities.length === 0) {
    return (
      <div className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-6 py-12 text-center">
        <p className="text-sm text-[var(--dpf-muted)] mb-2">
          No dependencies or estate items are attributed to this product yet.
        </p>
        <p className="text-xs text-[var(--dpf-muted)]">
          Attribute items during{" "}
          <Link href="/platform/tools/discovery" className="text-[var(--dpf-accent)]">discovery operations</Link>{" "}
          so this product view can explain what supports it and what it depends on.
        </p>
      </div>
    );
  }

  const estateItems = entities.map((entity) => createEstateItem(entity));
  const unknownSupportCount = estateItems.filter((item) => item.supportStatus === "unknown").length;
  const dependencyCount = estateItems.reduce((total, item) => total + item.upstreamCount + item.downstreamCount, 0);
  const staleEvidenceCount = estateItems.filter((item) => item.freshnessTone === "danger").length;
  const attentionCount = estateItems.filter((item) =>
    item.openIssueCount > 0
    || item.freshnessTone === "danger"
    || item.supportTone === "danger"
    || item.versionConfidenceTone !== "good"
  ).length;

  const groups = new Map<string, typeof estateItems>();
  for (const item of estateItems) {
    const key = item.providerViewLabel;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <section className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">
            Dependencies &amp; Estate
          </p>
          <h2 className="mt-2 text-lg font-semibold text-[var(--dpf-text)]">
            Understand the supporting estate behind {product.name}
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--dpf-muted)]">
            This view combines attributed discovery evidence, dependency counts, and support posture so you can see what this product relies on and where the weak spots are.
          </p>
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
            <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">Estate items</p>
            <p className="mt-2 text-2xl font-semibold text-[var(--dpf-text)]">{estateItems.length}</p>
          </div>
          <div className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
            <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">Needs attention</p>
            <p className="mt-2 text-2xl font-semibold text-[var(--dpf-text)]">{attentionCount}</p>
            <p className="mt-1 text-xs text-[var(--dpf-muted)]">
              {staleEvidenceCount} stale evidence item(s), {unknownSupportCount} with unknown support posture
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
            <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">Dependency links</p>
            <p className="mt-2 text-2xl font-semibold text-[var(--dpf-text)]">{dependencyCount}</p>
          </div>
          <div className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
            <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">Evidence confidence</p>
            <p className="mt-2 text-2xl font-semibold text-[var(--dpf-text)]">
              {estateItems.filter((item) => item.versionConfidenceTone === "good").length}
            </p>
            <p className="mt-1 text-xs text-[var(--dpf-muted)]">
              {estateItems.filter((item) => item.versionConfidenceTone !== "good").length} item(s) still need stronger version evidence
            </p>
          </div>
        </section>
      </div>

      {[...groups.entries()].map(([view, items]) => (
        <div key={view} className="mb-6">
          <h3 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-wide mb-2">
            {view}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {items.map((item) => (
              <EstateItemCard key={item.id} item={item} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
