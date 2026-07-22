// apps/web/lib/restaurant-cockpit/service-readiness-loader.ts
//
// Gathers the live inputs for the Restaurant owner service-readiness cockpit and
// hands them to the pure deriveServiceReadiness() model. Never throws — a load
// failure returns null so the host page renders unchanged (BI-075F731F).
//
// Deliberately reads only columns present on `main`. It does NOT depend on the
// storefront reservation-exception source (#3387) or the capacity/resource
// vocabulary work (#3402); it uses ServiceProvider as an honest bookable-resource
// proxy and EmployeeProfile as the staffing proxy.

import { prisma } from "@dpf/db";
import { getVocabulary } from "@/lib/storefront/archetype-vocabulary";
import {
  deriveServiceReadiness,
  type ServiceReadinessSummary,
  type ReadinessVocabulary,
} from "./service-readiness";

/** Statuses that mean a booking is awaiting the owner's confirmation. */
const UNCONFIRMED_STATUSES = ["pending", "needs-reschedule"] as const;
/** Statuses that no longer count as live demand or load. */
const DEAD_STATUSES = ["cancelled", "completed"] as const;

function resourceLabelFor(category: string | null | undefined): string {
  return category === "food-hospitality" ? "Tables & capacity" : "Bookable resources";
}

export interface LoadServiceReadinessArgs {
  storefrontId: string;
  category: string | null | undefined;
  customVocabulary?: Record<string, string> | null;
}

/**
 * Load the owner service-readiness summary for a storefront, or null on failure.
 */
export async function loadServiceReadiness(
  args: LoadServiceReadinessArgs,
): Promise<ServiceReadinessSummary | null> {
  const { storefrontId, category, customVocabulary } = args;
  try {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(startOfToday);
    endOfToday.setDate(endOfToday.getDate() + 1);

    const [
      unconfirmedBookings,
      pendingInquiries,
      confirmedUpcoming,
      scheduledToday,
      resourceCount,
      staffCount,
      businessProfile,
      billsDue,
      overdueInvoices,
    ] = await Promise.all([
      prisma.storefrontBooking.count({
        where: {
          storefrontId,
          status: { in: [...UNCONFIRMED_STATUSES] },
          overlapQuarantinedAt: null,
          scheduledAt: { gte: startOfToday },
        },
      }),
      prisma.storefrontInquiry.count({
        where: { storefrontId, status: "new" },
      }),
      prisma.storefrontBooking.count({
        where: {
          storefrontId,
          status: "confirmed",
          overlapQuarantinedAt: null,
          scheduledAt: { gte: now },
        },
      }),
      prisma.storefrontBooking.count({
        where: {
          storefrontId,
          status: { notIn: [...DEAD_STATUSES] },
          overlapQuarantinedAt: null,
          scheduledAt: { gte: startOfToday, lt: endOfToday },
        },
      }),
      prisma.serviceProvider.count({ where: { storefrontId, isActive: true } }),
      prisma.employeeProfile.count(),
      prisma.businessProfile.findFirst({
        where: { isActive: true },
        select: { hoursConfirmedAt: true },
      }),
      prisma.bill.count({ where: { status: { in: ["approved", "partially_paid"] } } }),
      prisma.invoice.count({ where: { status: "overdue" } }),
    ]);

    const base = getVocabulary(category, customVocabulary ?? null);
    const vocabulary: ReadinessVocabulary = {
      inboxLabel: base.inboxLabel,
      stakeholderLabel: base.stakeholderLabel,
      teamLabel: base.teamLabel,
      portalLabel: base.portalLabel,
      resourceLabel: resourceLabelFor(category),
    };

    return deriveServiceReadiness({
      vocabulary,
      demand: { pendingInquiries, unconfirmedBookings },
      serviceLoad: { confirmedUpcoming, scheduledToday },
      resources: {
        count: resourceCount,
        operatingHoursConfigured: Boolean(businessProfile?.hoursConfirmedAt),
      },
      staffing: { rostered: staffCount },
      finance: { billsDue, overdueInvoices },
    });
  } catch {
    return null;
  }
}
