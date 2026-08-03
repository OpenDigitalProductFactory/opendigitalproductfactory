import { notFound } from "next/navigation";
import { prisma } from "@dpf/db";
import { getActiveOrgCapabilities } from "@/lib/storefront/org-capabilities.server";
import {
  RentalDeskPanel,
  type RentalAgreementRow,
} from "@/components/rental/RentalDeskPanel";
import { occupancyPercent } from "@/lib/storefront/rental";
import { resolveRentalStorefront } from "@/lib/storefront/rental-scope.server";
import { getRentalCapacitySnapshot } from "@/lib/capacity/rental-capacity.server";
import { selectRentalPrimaryAttention } from "@/lib/storefront/rental-operations";

// Rental Desk daily board (BI-EEA24A34 Phase 4) — operator surface for the
// reserve → checkout → return & inspect → re-pool lifecycle. Capability-gated
// (rental-fleet OR rental-agreements) so it renders only for rental archetypes,
// per the same capability-driven-surface discipline as the civic pages.
export default async function RentalDeskPage() {
  const scope = await resolveRentalStorefront();
  if (!scope) notFound();
  const active = await getActiveOrgCapabilities();
  if (!active.has("rental-fleet") && !active.has("rental-agreements")) notFound();

  const [agreements, units, capacity] = await Promise.all([
    prisma.rentalAgreement.findMany({
      where: { storefrontId: scope.id },
      orderBy: { periodStart: "asc" },
      take: 200,
      include: {
        item: { select: { name: true } },
        rentableUnit: { select: { label: true } },
      },
    }),
    prisma.rentableUnit.findMany({
      where: { storefrontId: scope.id },
      select: { status: true },
    }),
    getRentalCapacitySnapshot({ organizationId: scope.organizationId, horizonDays: 14 }),
  ]);

  const live = agreements.filter((a) => !["closed", "cancelled"].includes(a.status));

  const rows: RentalAgreementRow[] = live.map((a) => ({
    id: a.id,
    ref: a.agreementRef,
    itemName: a.item?.name ?? "Rental",
    unitLabel: a.rentableUnit?.label ?? null,
    customerName: a.customerName,
    periodStart: a.periodStart.toISOString(),
    periodEnd: a.periodEnd.toISOString(),
    status: a.status,
    verificationStatus: a.verificationStatus,
    depositAmount: a.depositAmount != null ? Number(a.depositAmount) : null,
    currency: a.currency,
  }));

  const totalUnits = units.length;
  const occupiedUnits = units.filter((u) => ["reserved", "out"].includes(u.status)).length;
  const occupancy = occupancyPercent(totalUnits, occupiedUnits);
  const out = live.filter((a) => a.status === "active").length;
  const dueOut = live.filter((a) => a.status === "reserved" || a.status === "verified").length;
  const primaryAttention = selectRentalPrimaryAttention(capacity?.attentionSignals ?? []);
  const readyNow = capacity?.resources.filter((resource) => resource.status === "available").length ?? 0;
  const blockedNow = capacity?.resources.filter((resource) => {
    return resource.status === "blocked" || resource.status === "offline";
  }).length ?? 0;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Rental Desk</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          {dueOut} awaiting checkout · {out} out now
          {totalUnits > 0 && ` · ${occupancy}% of ${totalUnits} units occupied`}
        </p>
      </div>
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface)] p-4">
          <div className="text-2xl font-semibold tabular-nums text-[var(--dpf-text)]">{readyNow}</div>
          <div className="mt-1 text-xs font-medium uppercase tracking-wide text-[var(--dpf-muted)]">Ready</div>
        </div>
        <div className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface)] p-4">
          <div className="text-2xl font-semibold tabular-nums text-[var(--dpf-text)]">{blockedNow}</div>
          <div className="mt-1 text-xs font-medium uppercase tracking-wide text-[var(--dpf-muted)]">Blocked</div>
        </div>
        <div className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface)] p-4">
          <div className="text-2xl font-semibold tabular-nums text-[var(--dpf-text)]">{capacity?.allocations.length ?? 0}</div>
          <div className="mt-1 text-xs font-medium uppercase tracking-wide text-[var(--dpf-muted)]">Booked</div>
        </div>
      </div>
      {primaryAttention && (
        <section className="mb-6 rounded-xl border border-[var(--dpf-warning)] bg-[var(--dpf-surface)] p-4" aria-label="Priority">
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--dpf-warning)]">Act now</div>
          <div className="mt-1 text-base font-semibold text-[var(--dpf-text)]">{primaryAttention.title}</div>
          <p className="mt-1 text-sm text-[var(--dpf-muted)]">{primaryAttention.detail}</p>
          <p className="mt-3 text-sm font-medium text-[var(--dpf-text)]">
            Next: {primaryAttention.recommendedAction}
          </p>
        </section>
      )}
      <RentalDeskPanel agreements={rows} />
    </div>
  );
}
