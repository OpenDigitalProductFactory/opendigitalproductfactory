// apps/web/app/(shell)/portfolio/product/[id]/offerings/page.tsx
//
// Offerings tab — operational service commitments for a DigitalProduct.

import { prisma } from "@dpf/db";
import {
  loadDigitalProductOperationalOfferings,
  type OperationalOfferingClient,
} from "@/lib/products/operational-offerings";
import { notFound } from "next/navigation";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function ProductOfferingsPage({ params }: Props) {
  const { id } = await params;

  const { exists, offerings } =
    await loadDigitalProductOperationalOfferings(
      prisma as unknown as OperationalOfferingClient,
      id,
    );

  if (!exists) notFound();

  if (offerings.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-[var(--dpf-muted)]">
          No operational service commitments defined for this digital product yet.
        </p>
        <p className="text-xs text-[var(--dpf-muted)] mt-1">
          Add a service offering when availability, recovery, or support commitments need to be managed.
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
                  background:
                    o.status === "active"
                      ? "color-mix(in srgb, var(--dpf-success) 13%, transparent)"
                      : "var(--dpf-surface-2)",
                  color:
                    o.status === "active"
                      ? "var(--dpf-success)"
                      : "var(--dpf-muted)",
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

            {o.commercialTrace && (
              <details className="mt-3 border-t border-[var(--dpf-border)] pt-2">
                <summary className="cursor-pointer text-[10px] font-medium text-[var(--dpf-muted)]">
                  Commercial trace · {o.commercialTrace.catalogItems.length} catalog item
                  {o.commercialTrace.catalogItems.length === 1 ? "" : "s"}
                </summary>
                <div className="mt-2 space-y-1">
                  {o.commercialTrace.catalogItems.map((item) => (
                    <div
                      key={item.catalogItemId}
                      className="flex items-center justify-between gap-3 text-[10px]"
                    >
                      <span className="truncate text-[var(--dpf-text)]">{item.name}</span>
                      <span className="shrink-0 text-[var(--dpf-muted)]">{item.status}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
