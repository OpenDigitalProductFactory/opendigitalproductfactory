import { prisma } from "@dpf/db";

import type {
  BusinessMetricRollupDeps,
  RestaurantMetricContext,
} from "./business-metric-rollup";
import { PERFORMANCE_METRIC_ARCHETYPES } from "./performance-metric-support";
import { getScopedLedgerPeriodReport } from "@/lib/finance/ledger-service";
import { inspectSoftwareLedgerPack } from "./software-ledger-metrics";
import type { BusinessMetricRollupInput } from "./business-metric-rollup";

function upsertMetric(row: BusinessMetricRollupInput, computedAt: Date, db: Pick<typeof prisma, "businessMetricRollup"> = prisma) {
  const { organizationId, metricKey, periodStart, periodEnd, dimensionsHash, definitionVersion, ...values } = row;
  const identity = { organizationId, metricKey, periodStart, periodEnd, dimensionsHash, definitionVersion };
  return db.businessMetricRollup.upsert({
    where: { organizationId_metricKey_periodStart_periodEnd_dimensionsHash_definitionVersion: identity },
    create: { ...identity, ...values, computedAt }, update: { ...values, computedAt },
  });
}

/** Prisma adapter kept separate from the deterministic projection math. */
export function defaultBusinessMetricRollupDeps(): BusinessMetricRollupDeps {
  return {
    async listRestaurantContexts() {
      const [storefronts, profile] = await Promise.all([
        prisma.storefrontConfig.findMany({
          // Only archetypes the engine has a source loader for — kept in one
          // place so the surface's "not available for this business type" copy
          // and this scan can never disagree. BI-F359E1E9.
          where: {
            archetype: { archetypeId: { in: PERFORMANCE_METRIC_ARCHETYPES.filter(id => id === "restaurant") } },
          },
          select: { id: true, organizationId: true, timezone: true },
        }),
        prisma.businessProfile.findFirst({
          where: { isActive: true },
          select: { businessHours: true, hoursConfirmedAt: true },
        }),
      ]);
      const businessHours = profile?.businessHours as RestaurantMetricContext["businessHours"];
      return storefronts.map((storefront) => ({
        organizationId: storefront.organizationId,
        storefrontId: storefront.id,
        timezone: storefront.timezone || "UTC",
        hoursConfirmedAt: profile?.hoursConfirmedAt ?? null,
        businessHours: businessHours ?? null,
      }));
    },
    async loadRestaurantSource(context, window, computedAt) {
      const [resources, turns, allocations, bookings] = await Promise.all([
        prisma.hospitalityResource.findMany({
          where: { organizationId: context.organizationId, storefrontId: context.storefrontId },
          select: { id: true, kind: true, status: true },
        }),
        prisma.hospitalityServiceTurn.findMany({
          where: {
            organizationId: context.organizationId,
            storefrontId: context.storefrontId,
            startedAt: { gte: window.start, lt: window.end },
          },
          select: {
            id: true,
            startedAt: true,
            closedAt: true,
            booking: { select: { covers: true } },
          },
        }),
        prisma.hospitalityCapacityAllocation.findMany({
          where: {
            organizationId: context.organizationId,
            storefrontId: context.storefrontId,
            serviceTurnId: { not: null },
            startsAt: { lt: window.end },
            endsAt: { gt: window.start },
          },
          select: { resourceId: true, serviceTurnId: true, startsAt: true, endsAt: true },
        }),
        prisma.storefrontBooking.findMany({
          where: {
            organizationId: context.organizationId,
            storefrontId: context.storefrontId,
            scheduledAt: { gte: window.start, lt: window.end },
          },
          select: {
            id: true,
            scheduledAt: true,
            status: true,
            hospitalityServiceTurn: { select: { id: true } },
          },
        }),
      ]);

      return {
        ...context,
        window,
        computedAt,
        resources,
        serviceTurns: turns.map((turn) => ({
          id: turn.id,
          startedAt: turn.startedAt,
          closedAt: turn.closedAt,
          covers: turn.booking?.covers ?? null,
        })),
        allocations,
        bookings: bookings.map((booking) => ({
          id: booking.id,
          scheduledAt: booking.scheduledAt,
          status: booking.status,
          hasServiceTurn: booking.hospitalityServiceTurn !== null,
        })),
      };
    },
    async upsert(row, computedAt) { await upsertMetric(row, computedAt); },
    software: {
      async listContexts() {
        const contexts = await prisma.storefrontConfig.findMany({
          where: { archetype: { archetypeId: { in: PERFORMANCE_METRIC_ARCHETYPES.filter(id => id === "software-platform") } } },
          select: { id: true, organizationId: true }, orderBy: { id: "asc" }, take: 1001,
        });
        if (contexts.length > 1000) throw new Error("Software results context scan exceeds its supported bound.");
        return contexts.map(row => ({ organizationId: row.organizationId, storefrontId: row.id }));
      },
      loadReport: (context, window, checkedAt) => getScopedLedgerPeriodReport(context.organizationId, window.periodKey, checkedAt),
      async upsertPeriod(rows, computedAt) {
        const first = rows[0];
        if (!first || rows.some(r => r.organizationId !== first.organizationId || r.dimensionsHash !== first.dimensionsHash)
          || !inspectSoftwareLedgerPack(rows.map(row => ({ ...row, computedAt }))).valid) {
          throw new Error("Refusing an incomplete or mixed software results pack.");
        }
        if (first.availability === "unavailable") {
          const retained = await prisma.$transaction(async tx => {
            const prior = await tx.businessMetricRollup.findMany({ where: {
              organizationId: first.organizationId, dimensionsHash: first.dimensionsHash,
              definitionVersion: first.definitionVersion, periodStart: first.periodStart, periodEnd: first.periodEnd,
              metricKey: { in: rows.map(row => row.metricKey) },
            }, take: 4 });
            const pack = inspectSoftwareLedgerPack(prior.map(row => ({ ...row,
              value: row.value === null ? null : Number(row.value),
              availability: row.availability === "available" ? "available" : "unavailable",
            })));
            if (pack.valid && prior.every(row => row.availability === "available")) {
              if (computedAt < prior[0]!.computedAt) return true;
              const sourceLineage = { ...pack.lineage, refreshFailure: { at: computedAt.toISOString(), kind: "source-unavailable" } };
              await Promise.all(prior.map(row => tx.businessMetricRollup.update({ where: { id: row.id }, data: { sourceLineage } })));
              return true;
            }
            await Promise.all(rows.map(row => upsertMetric(row, computedAt, tx)));
            return false;
          }, { isolationLevel: "Serializable" });
          // Commit only failure metadata; the values, generation and source age stay unchanged.
          if (retained) throw new Error("Software results refresh unavailable; last valid snapshot retained.");
          return;
        }
        await prisma.$transaction(rows.map(row => upsertMetric(row, computedAt)));
      },
    },
  };
}
