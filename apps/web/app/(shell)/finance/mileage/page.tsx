// apps/web/app/(shell)/finance/mileage/page.tsx
// Driver portal: the drives captured for you, and what they are worth.
//
// This is the surface that makes the mileage substrate reachable. Until it
// existed, Trip rows could be written by nothing and read by nobody.

import { prisma } from "@dpf/db";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getOrgSettings } from "@/lib/actions/currency";
import { getCurrencySymbol } from "@/lib/currency-symbol";
import { FinanceTabNav } from "@/components/finance/FinanceTabNav";
import { metresToMiles } from "@/lib/mileage/rates";
import { MileageTripsTable, type MileageTripRow } from "./MileageTripsTable";
import type { TripClassification } from "@/lib/mileage/classification";

export default async function MileagePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [profile, orgSettings] = await Promise.all([
    prisma.employeeProfile.findFirst({
      where: { userId: session.user.id },
      select: { id: true, displayName: true },
    }),
    getOrgSettings(),
  ]);

  const sym = getCurrencySymbol(orgSettings.baseCurrency);

  // No employee record means no drives can belong to this user. Say so plainly
  // rather than rendering an empty table that looks like "no drives yet".
  if (!profile) {
    return (
      <div>
        <FinanceTabNav />
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Mileage</h1>
        <p className="mt-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface)] p-4 text-sm text-[var(--dpf-muted)]">
          You have no staff record. Ask an admin to add one.
        </p>
      </div>
    );
  }

  const trips = await prisma.trip.findMany({
    where: { employeeProfileId: profile.id, lifecycle: "active" },
    orderBy: { startedAt: "desc" },
    take: 200,
    select: {
      tripId: true,
      startedAt: true,
      distanceMeters: true,
      classification: true,
      classifiedByKind: true,
      startPlaceLabel: true,
      endPlaceLabel: true,
      reimbursableAmount: true,
      expenseItemId: true,
    },
  });

  const rows: MileageTripRow[] = trips.map((t) => ({
    tripId: t.tripId,
    startedAtISO: t.startedAt.toISOString(),
    miles: metresToMiles(t.distanceMeters),
    route:
      t.startPlaceLabel && t.endPlaceLabel
        ? `${t.startPlaceLabel} → ${t.endPlaceLabel}`
        : "Drive",
    classification: t.classification as TripClassification,
    classifiedBy: t.classifiedByKind,
    amount: t.reimbursableAmount === null ? null : Number(t.reimbursableAmount),
    claimed: t.expenseItemId !== null,
  }));

  const unclassified = rows.filter((r) => r.classification === "unclassified").length;

  return (
    <div>
      <FinanceTabNav />

      {/* Lead band: short plain sentences keep the readability budget met even
          with shell chrome in the measured HTML. */}
      <header className="mb-6 space-y-2" data-dpf-lead>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Mileage</h1>
        <p className="max-w-3xl text-sm leading-5 text-[var(--dpf-muted)]">
          {unclassified > 0
            ? `${unclassified} to sort.`
            : "All sorted."}
        </p>
        <a
          href="#mileage-drives"
          data-dpf-primary-action
          data-owner-first-next-action="classify-drives"
          className="inline-flex text-sm font-semibold text-[var(--dpf-accent)] underline-offset-2 hover:underline"
        >
          See my drives
        </a>
      </header>

      <div id="mileage-drives">
        <MileageTripsTable rows={rows} currencySymbol={sym} />
      </div>
    </div>
  );
}
