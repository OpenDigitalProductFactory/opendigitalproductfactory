// apps/web/app/(shell)/portfolio/product/[id]/health/page.tsx
//
// Health tab - product-specific health metrics.
// For the portal product (dpf-portal), renders the service-level health dashboard.
// For other products, shows observation config and SLA compliance.

import { prisma } from "@dpf/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ServiceHealthDashboard } from "@/components/monitoring/ServiceHealthDashboard";
import { TONE_COLOR, type Tone } from "@/components/monitoring/health-summary";

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
        <PortalHealth openBugs={product._count.backlogItems} productId={id} />
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

function PortalHealth({ openBugs, productId }: { openBugs: number; productId: string }) {
  return (
    <ServiceHealthDashboard
      openBacklogItems={openBugs}
      backlogHref={`/portfolio/product/${productId}/backlog`}
    />
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
          label="Open Backlog Items"
          value={String(openBugs)}
          tone={openBugs > 0 ? "warning" : "success"}
          href={`/portfolio/product/${productId}/backlog`}
          hint={openBugs > 0 ? "View list" : undefined}
        />
        <HealthCard
          label="SLA Targets"
          value={`${offerings.length} defined`}
          tone={hasOfferings ? "success" : "neutral"}
        />
        <HealthCard
          label="Observation"
          value={hasObservation ? "Configured" : "Not set"}
          tone={hasObservation ? "success" : "neutral"}
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
  tone,
  href,
  hint,
}: {
  label: string;
  value: string;
  tone: Tone;
  href?: string;
  hint?: string;
}) {
  const body = (
    <div className="bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] rounded-lg p-4 transition-colors hover:border-[var(--dpf-accent)]">
      <div className="text-lg font-bold" style={{ color: TONE_COLOR[tone] }}>
        {value}
      </div>
      <div className="text-[11px] text-[var(--dpf-muted)] mt-1">{label}</div>
      {hint && (
        <div className="text-[10px] text-[var(--dpf-accent)] mt-1">{hint} -&gt;</div>
      )}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block">
        {body}
      </Link>
    );
  }
  return body;
}
