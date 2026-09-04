import { prisma } from "@dpf/db";

import { loadWardBoard, type WardStoreClient } from "@/lib/ward/ward-store";
import { summarizeKennelCapacity } from "@/lib/ward/ward-occupancy";
import {
  buildRescueCockpit,
  sourceAvailable,
  sourceEmpty,
  sourceUnavailable,
  type RescueSources,
  type SourceState,
} from "./cockpit";

async function observe<T>(load: () => Promise<T>, isEmpty: (value: T) => boolean): Promise<SourceState<T>> {
  try {
    const value = await load();
    return isEmpty(value) ? sourceEmpty(value) : sourceAvailable(value);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "The source could not be read";
    return sourceUnavailable(reason);
  }
}

export async function resolveRescueOrganizationId(): Promise<string | null> {
  const config = await prisma.storefrontConfig.findFirst({
    where: { archetype: { archetypeId: "pet-rescue" } },
    select: { organizationId: true },
  });
  return config?.organizationId ?? null;
}

/**
 * A bounded, read-only projection. Each lane reports unavailable independently;
 * one failed subsystem must not turn unknown data into a reassuring zero.
 */
export async function loadRescueCockpitData(organizationId: string, options: { canViewFinance?: boolean } = {}) {
  const now = new Date();
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const activeWork = { notIn: ["completed", "cancelled", "failed"] };

  const results = await Promise.all([
    observe(async () => {
      const [inCare, intakeReview, legalHold, placementReady] = await Promise.all([
        prisma.animalProfile.count({ where: { organizationId, lifecycleStatus: { in: ["in_care", "placement_ready"] } } }),
        prisma.animalCustodyEpisode.count({ where: { organizationId, closedAt: null, currentStage: "intake" } }),
        prisma.animalCustodyEpisode.count({ where: { organizationId, closedAt: null, legalHoldActive: true } }),
        prisma.animalProfile.count({ where: { organizationId, lifecycleStatus: "placement_ready" } }),
      ]);
      return { inCare, intakeReview, legalHold, placementReady };
    }, (value) => value.inCare === 0),
    observe(async () => {
      const board = await loadWardBoard({ organizationId, db: prisma as unknown as WardStoreClient });
      const summary = summarizeKennelCapacity(board);
      if (!summary) return { free: 0, blocked: 0 };
      return { free: summary.free, blocked: summary.outOfService };
    }, (value) => value.free === 0 && value.blocked === 0),
    observe(async () => {
      const [dueToday, missed, exceptions] = await Promise.all([
        prisma.workEngagement.count({ where: { organizationId, subjectKindSlug: "animal-profile", status: activeWork, dueAt: { gte: now, lte: endOfToday } } }),
        prisma.workEngagement.count({ where: { organizationId, subjectKindSlug: "animal-profile", status: activeWork, dueAt: { lt: now } } }),
        prisma.careRecord.count({ where: { organizationId, subjectKindSlug: "animal-profile", status: "active", legalHold: true } }),
      ]);
      return { dueToday, missed, exceptions };
    }, (value) => value.dueToday === 0 && value.missed === 0 && value.exceptions === 0),
    observe(async () => {
      const [activeApplications, readyWithoutInterest] = await Promise.all([
        prisma.animalAdoptionApplication.count({ where: { organizationId, status: { in: ["submitted", "screening", "meet_and_greet", "home_check", "approved", "waitlisted"] } } }),
        prisma.animalProfile.count({ where: { organizationId, lifecycleStatus: "placement_ready", applications: { none: { status: { in: ["submitted", "screening", "meet_and_greet", "home_check", "approved", "waitlisted"] } } } } }),
      ]);
      return { activeApplications, readyWithoutInterest };
    }, (value) => value.activeApplications === 0 && value.readyWithoutInterest === 0),
    options.canViewFinance ? observe(async () => {
      const [restrictedFunds, animalCost] = await Promise.all([
        prisma.financialFund.count({
          where: {
            organizationId,
            isActive: true,
            restriction: { in: ["temporarily_restricted", "permanently_restricted"] },
          },
        }),
        prisma.journalLine.aggregate({
          where: { subjectKindSlug: "animal-profile", journalEntry: { organizationId, status: "posted" } },
          _sum: { debit: true, credit: true },
        }),
      ]);
      const postedAnimalCost = Number(animalCost._sum.debit ?? 0) - Number(animalCost._sum.credit ?? 0);
      return { restrictedFunds, postedAnimalCost };
    }, (value) => value.restrictedFunds === 0 && value.postedAnimalCost === 0) : Promise.resolve(sourceUnavailable("Finance access is required")),
  ]);
  const [animals, capacity, care, adoptions, stewardship] = results as [
    RescueSources["animals"],
    RescueSources["capacity"],
    RescueSources["care"],
    RescueSources["adoptions"],
    RescueSources["stewardship"],
  ];

  return buildRescueCockpit({ animals, capacity, care, adoptions, stewardship });
}
