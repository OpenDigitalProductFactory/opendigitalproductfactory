import { notFound } from "next/navigation";
import { prisma } from "@dpf/db";
import { getActiveOrgCapabilities } from "@/lib/storefront/org-capabilities.server";
import {
  RentalDeskPanel,
  type RentalAgreementRow,
} from "@/components/rental/RentalDeskPanel";
import { occupancyPercent } from "@/lib/storefront/rental";

// Rental Desk daily board (BI-EEA24A34 Phase 4) — operator surface for the
// reserve → checkout → return & inspect → re-pool lifecycle. Capability-gated
// (rental-fleet OR rental-agreements) so it renders only for rental archetypes,
// per the same capability-driven-surface discipline as the civic pages.
export default async function RentalDeskPage() {
  const active = await getActiveOrgCapabilities();
  if (!active.has("rental-fleet") && !active.has("rental-agreements")) notFound();

  const [agreements, units] = await Promise.all([
    prisma.rentalAgreement.findMany({
      orderBy: { periodStart: "asc" },
      take: 200,
      include: {
        item: { select: { name: true } },
        rentableUnit: { select: { label: true } },
      },
    }),
    prisma.rentableUnit.findMany({ select: { status: true } }),
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

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Rental Desk</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          {dueOut} awaiting checkout · {out} out now
          {totalUnits > 0 && ` · ${occupancy}% of ${totalUnits} units occupied`}
        </p>
      </div>
      <RentalDeskPanel agreements={rows} />
    </div>
  );
}
