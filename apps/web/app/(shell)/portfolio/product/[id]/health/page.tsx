// apps/web/app/(shell)/portfolio/product/[id]/health/page.tsx
//
// Health tab — product-specific health metrics.
// For the portal product (dpf-portal), renders the service-level health dashboard.
// For other products, shows observation config and SLA compliance.

import { prisma } from "@dpf/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ServiceHealthDashboard } from "@/components/monitoring/ServiceHealthDashboard";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function ProductHealthPage({ params }: Props) {
  const { id } = await params;

  const product = await prisma.digitalProduct.findUnique({
    where: { id },
    select: {
      id: true,
      productId: true,
      observationConfig: true,
      serviceOfferings: {
        select: {
          id: true,
          name: true,
          availabilityTarget: true,
          mttrHours: true,
          rtoHours: true,
        },
      },
      _count: {
        select: {
          backlogItems: { where: { status: "open" } },
        },
      },
    },
  });

  if (!product) notFound();

  const isPortal = product.productId === "dpf-portal";
  const hasOfferings = product.serviceOfferings.length > 0;
  const hasObservation = product.observationConfig != null;

  return (
    <div>
      {isPortal ? (
        <PortalHealth openBugs={product._count.backlogItems} />
      ) : (
        <ProductHealth
          hasObservation={hasObservation}
          hasOfferings={hasOfferings}
          offerings={product.serviceOfferings}
          openBugs={product._count.backlogItems}
          productId={id}
        />
      )}
    </div>
  );
}

function PortalHealth({ openBugs }: { openBugs: number }) {
  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <HealthCard label="Platform Status" value="Operational" colour="#4ade80" />
        <HealthCard label="Open Issues" value={String(openBugs)} colour={openBugs > 0 ? "#fbbf24" : "#4ade80"} />
        <HealthCard label="Health Monitoring" value="Active" colour="#4ade80" />
      </div>
      <ServiceHealthDashboard />
    </div>
  );
}

function ProductHealth({
  hasObservation,
  hasOfferings,
  offerings,
  openBugs,
  productId,
}: {
  hasObservation: boolean;
  hasOfferings: boolean;
  offerings: Array<{
    id: string;
    name: string;
    availabilityTarget: number | null;
    mttrHours: number | null;
    rtoHours: number | null;
  }>;
  openBugs: number;
  productId: string;
}) {
  if (!hasObservation && !hasOfferings) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-[var(--dpf-muted)] mb-2">
          No health monitoring configured for this product yet.
        </p>
        <p className="text-xs text-[var(--dpf-muted)]">
          Add service offerings with SLA targets on the{" "}
          <Link href={`/portfolio/product/${productId}/offerings`} className="text-[var(--dpf-accent)]">
            Offerings tab
          </Link>{" "}
          to enable health tracking.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <HealthCard
          label="Open Issues"
          value={String(openBugs)}
          colour={openBugs > 0 ? "#fbbf24" : "#4ade80"}
        />
        <HealthCard
          label="SLA Targets"
          value={`${offerings.length} defined`}
          colour={hasOfferings ? "#4ade80" : "#8888a0"}
        />
        <HealthCard
          label="Observation"
          value={hasObservation ? "Configured" : "Not set"}
          colour={hasObservation ? "#4ade80" : "#8888a0"}
        />
      </div>

      {hasOfferings && (
        <div className="bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] rounded-lg p-5">
          <h3 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-wide mb-3">
            Service Level Targets
          </h3>
          <div className="flex flex-col gap-2">
            {offerings.map((o) => (
              <div
                key={o.id}
                className="flex items-center gap-4 text-xs px-3 py-2 rounded bg-[var(--dpf-bg)] border border-[var(--dpf-border)]"
              >
                <span className="text-[var(--dpf-text)] flex-1">{o.name}</span>
                {o.availabilityTarget != null && (
                  <span className="text-[var(--dpf-muted)]">
                    Avail: {o.availabilityTarget}%
                  </span>
                )}
                {o.mttrHours != null && (
                  <span className="text-[var(--dpf-muted)]">MTTR: {o.mttrHours}h</span>
                )}
                {o.rtoHours != null && (
                  <span className="text-[var(--dpf-muted)]">RTO: {o.rtoHours}h</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function HealthCard({
  label,
  value,
  colour,
}: {
  label: string;
  value: string;
  colour: string;
}) {
  return (
    <div className="bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] rounded-lg p-4">
      <div className="text-lg font-bold" style={{ color: colour }}>
        {value}
      </div>
      <div className="text-[11px] text-[var(--dpf-muted)] mt-1">{label}</div>
    </div>
  );
}
