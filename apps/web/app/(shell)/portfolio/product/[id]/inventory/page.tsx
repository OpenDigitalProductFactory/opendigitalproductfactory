// apps/web/app/(shell)/portfolio/product/[id]/inventory/page.tsx
//
// Inventory tab — discovered infrastructure and software entities for this product.

import {
  INVENTORY_ENTITY_CANONICAL_WHERE,
  INVENTORY_RELATIONSHIP_CANONICAL_WHERE,
  prisma,
} from "@dpf/db";
import { notFound } from "next/navigation";
import Link from "next/link";

import { EstateItemCard } from "@/components/inventory/EstateItemCard";
import { ProductRelationshipsSection } from "@/components/product/ProductRelationshipsSection";
import { ProductSoftwareCompositionPanel } from "@/components/product/ProductSoftwareCompositionPanel";
import { KpiCard } from "@/components/ui/report-kit";
import { Surface } from "@/components/ui/Surface";
import { getLatestBomComponentsForProduct } from "@/lib/assurance/bom-read";
import { listActiveFindingsForProduct } from "@/lib/assurance/finding-read";
import { createEstateItem } from "@/lib/estate/estate-item";
import { deriveCurrency, deriveSupportEndDate } from "@/lib/lifecycle";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function ProductInventoryPage({ params }: Props) {
  const { id } = await params;

  const [product, entities, relationships, bomRows, findings] = await Promise.all([
    prisma.digitalProduct.findUnique({ where: { id }, select: { id: true, productId: true, name: true } }),
    prisma.inventoryEntity.findMany({
      where: { ...INVENTORY_ENTITY_CANONICAL_WHERE, digitalProductId: id },
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
            fromRelationships: { where: INVENTORY_RELATIONSHIP_CANONICAL_WHERE },
            toRelationships: { where: INVENTORY_RELATIONSHIP_CANONICAL_WHERE },
          },
        },
      },
    }),
    prisma.productDependency.findMany({
      where: { OR: [{ fromProductId: id }, { toProductId: id }] },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        relationType: true,
        source: true,
        fromProduct: { select: { id: true, name: true } },
        toProduct: { select: { id: true, name: true } },
      },
    }),
    getLatestBomComponentsForProduct(prisma, id),
    listActiveFindingsForProduct(prisma, id, 25),
  ]);

  if (!product) notFound();

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
  const currencyAttentionCount = bomRows.components.filter((component) => {
    const currency = deriveCurrency({
      supportEndsAt: deriveSupportEndDate(component.lifecycleMilestones),
    });
    return currency === "approaching-eol" || currency === "unsupported" || currency === "end-of-life";
  }).length;

  return (
    <div className="space-y-10">
      <Surface as="section" padding="none" rounded="xl" className="p-5">
        <p className="text-dpf-caption uppercase tracking-[0.18em] text-[var(--dpf-muted)]">Dependencies</p>
        <h2 className="mt-2 text-xl font-semibold text-[var(--dpf-text)]">
          What supports {product.name}
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--dpf-muted)]">
          Product relationships, attributed estate, and the software bill of materials now share one product context and one lifecycle currency model.
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label="Dependencies summary">
          <KpiCard bordered={false} size="sm" label="Product relationships" value={relationships.length} />
          <KpiCard bordered={false} size="sm" label="Estate items" value={estateItems.length} />
          <KpiCard bordered={false} size="sm" label="SBOM components" value={bomRows.latestBom?.componentCount ?? 0} />
          <KpiCard bordered={false} size="sm" intent={currencyAttentionCount > 0 ? "warning" : "success"} label="Currency attention" value={currencyAttentionCount} />
        </div>
        <nav aria-label="Dependencies sections" className="mt-4 flex flex-wrap gap-2 text-xs">
          <a className="rounded-full border border-[var(--dpf-border)] px-3 py-1.5 text-[var(--dpf-accent)]" href="#product-relationships">Product relationships</a>
          <a className="rounded-full border border-[var(--dpf-border)] px-3 py-1.5 text-[var(--dpf-accent)]" href="#attributed-estate">Attributed estate</a>
          <a className="rounded-full border border-[var(--dpf-border)] px-3 py-1.5 text-[var(--dpf-accent)]" href="#software-composition">Software composition</a>
        </nav>
      </Surface>

      <div id="product-relationships" className="scroll-mt-6">
        <ProductRelationshipsSection productId={id} relationships={relationships} />
      </div>

      <section id="attributed-estate" className="scroll-mt-6 space-y-4" aria-labelledby="attributed-estate-heading">
        <div>
          <h2 id="attributed-estate-heading" className="text-lg font-semibold text-[var(--dpf-text)]">Attributed estate</h2>
          <p className="mt-1 text-sm text-[var(--dpf-muted)]">Discovered infrastructure and software attributed to this product.</p>
        </div>

        {estateItems.length === 0 ? (
          <Surface padding="none" rounded="xl" className="border-dashed px-6 py-8 text-center">
            <p className="text-sm text-[var(--dpf-muted)] mb-2">No estate items are attributed to this product yet.</p>
            <p className="text-xs text-[var(--dpf-muted)]">
              Attribute items during <Link href="/platform/tools/discovery" className="text-[var(--dpf-accent)]">discovery operations</Link> to connect operational evidence.
            </p>
          </Surface>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard size="sm" label="Estate items" value={estateItems.length} />
              <KpiCard size="sm" intent={attentionCount > 0 ? "warning" : "success"} label="Needs attention" value={attentionCount} hint={`${staleEvidenceCount} stale; ${unknownSupportCount} unknown support`} />
              <KpiCard size="sm" label="Dependency links" value={dependencyCount} />
              <KpiCard
                size="sm"
                label="Strong version evidence"
                value={estateItems.filter((item) => item.versionConfidenceTone === "good").length}
                hint={`${estateItems.filter((item) => item.versionConfidenceTone !== "good").length} need stronger evidence`}
              />
            </div>
            {[...groups.entries()].map(([view, items]) => (
              <div key={view}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--dpf-muted)]">{view}</h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {items.map((item) => <EstateItemCard key={item.id} item={item} />)}
                </div>
              </div>
            ))}
          </>
        )}
      </section>

      <section aria-labelledby="software-composition" className="scroll-mt-6 border-t border-[var(--dpf-border)] pt-8">
        <ProductSoftwareCompositionPanel
          productId={id}
          latestBom={bomRows.latestBom}
          components={bomRows.components}
          findingSummary={bomRows.findingSummary}
          scanner={bomRows.scanner}
          findings={findings}
          platformProduct={product.productId === "dpf-portal"}
        />
      </section>
    </div>
  );
}
