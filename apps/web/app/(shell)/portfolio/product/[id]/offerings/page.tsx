// apps/web/app/(shell)/portfolio/product/[id]/offerings/page.tsx
//
// Offerings tab — service offerings, SLA targets, and pricing for this product.

import { prisma } from "@dpf/db";
import { notFound } from "next/navigation";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function ProductOfferingsPage({ params }: Props) {
  const { id } = await params;

  const [product, offerings] = await Promise.all([
    prisma.digitalProduct.findUnique({ where: { id }, select: { id: true } }),
    prisma.serviceOffering.findMany({
      where: { digitalProductId: id },
      orderBy: { name: "asc" },
      select: {
        id: true,
        offeringId: true,
        name: true,
        description: true,
        availabilityTarget: true,
        mttrHours: true,
        rtoHours: true,
        rpoHours: true,
        supportHours: true,
        status: true,
      },
    }),
  ]);

  if (!product) notFound();

  if (offerings.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-[var(--dpf-muted)]">
          No service offerings defined for this product yet.
        </p>
        <p className="text-xs text-[var(--dpf-muted)] mt-1">
          Service offerings define how this product is consumed — tiers, SLA targets, and pricing models.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="text-xs text-[var(--dpf-muted)] mb-4">
        {offerings.length} offering{offerings.length !== 1 ? "s" : ""}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {offerings.map((o) => (
          <div
            key={o.id}
            className="p-4 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]"
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-medium text-[var(--dpf-text)]">{o.name}</span>
              <span
                className="text-[9px] px-1.5 py-0.5 rounded-full"
                style={{
                  background: o.status === "active" ? "#4ade8020" : "#8888a020",
                  color: o.status === "active" ? "#4ade80" : "#8888a0",
                }}
              >
                {o.status}
              </span>
            </div>

            {o.description && (
              <p className="text-[11px] text-[var(--dpf-muted)] mb-2">{o.description}</p>
            )}

            <div className="flex flex-wrap gap-3 text-[10px] text-[var(--dpf-muted)]">
              {o.availabilityTarget != null && <span>Avail: {o.availabilityTarget}%</span>}
              {o.mttrHours != null && <span>MTTR: {o.mttrHours}h</span>}
              {o.rtoHours != null && <span>RTO: {o.rtoHours}h</span>}
              {o.rpoHours != null && <span>RPO: {o.rpoHours}h</span>}
              {o.supportHours && <span>Support: {o.supportHours}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
