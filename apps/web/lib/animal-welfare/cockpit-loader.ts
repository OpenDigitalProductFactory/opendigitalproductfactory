import { prisma } from "@dpf/db";

import { loadWardBoard, type WardStoreClient } from "@/lib/ward/ward-store";
import { summarizeKennelCapacity } from "@/lib/ward/ward-occupancy";
import { resolveOrgLocale, type OrgLocaleClient } from "@/lib/org-locale/org-locale";
import {
  buildRescueCockpit,
  sourceAvailable,
  sourceEmpty,
  sourceUnavailable,
  type RescueFilter,
  type RescueFilterArea,
  type RescueQueueData,
  type RescueSources,
  type SourceState,
} from "./cockpit";

export async function observeRescueSource<T>(input: {
  load: () => Promise<T>;
  isEmpty: (value: T) => boolean;
  unavailableReason: string;
  asOf: string;
}): Promise<SourceState<T>> {
  try {
    const value = await input.load();
    return input.isEmpty(value)
      ? sourceEmpty(value, input.asOf)
      : sourceAvailable(value, input.asOf);
  } catch {
    return sourceUnavailable(input.unavailableReason, input.asOf);
  }
}

export type RescueScopeDb = {
  platformSetupProgress: {
    findUnique(args: unknown): Promise<{ organizationId: string | null } | null>;
  };
  organization: {
    findMany(args: unknown): Promise<Array<{ id: string }>>;
  };
  storefrontConfig: {
    findUnique(args: unknown): Promise<{
      organizationId: string;
      timezone: string;
      archetype: { archetypeId: string };
    } | null>;
  };
};

function validTimeZone(value: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return value;
  } catch {
    return "UTC";
  }
}

export async function resolveRescueOrganizationScope(
  userId: string,
  db: RescueScopeDb = prisma as unknown as RescueScopeDb,
): Promise<{ organizationId: string; timeZone: string } | null> {
  try {
    const setup = await db.platformSetupProgress.findUnique({
      where: { userId },
      select: { organizationId: true },
    });
    let organizationId = setup?.organizationId ?? null;

    if (!organizationId) {
      const organizations = await db.organization.findMany({
        select: { id: true },
        orderBy: { createdAt: "asc" },
        take: 2,
      });
      if (organizations.length !== 1) return null;
      organizationId = organizations[0]?.id ?? null;
    }

    if (!organizationId) return null;
    const config = await db.storefrontConfig.findUnique({
      where: { organizationId },
      select: {
        organizationId: true,
        timezone: true,
        archetype: { select: { archetypeId: true } },
      },
    });
    if (config?.archetype.archetypeId !== "pet-rescue") return null;
    return { organizationId: config.organizationId, timeZone: validTimeZone(config.timezone) };
  } catch {
    return null;
  }
}

const QUEUE_LIMIT = 25;
const ACTIVE_APPLICATION_STATUSES = [
  "submitted",
  "screening",
  "meet_and_greet",
  "home_check",
  "approved",
  "waitlisted",
] as const;

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

function localMidnightUtc(periodKey: string, timeZone: string): Date {
  const [year, month, day] = periodKey.split("-").map(Number);
  const target = Date.UTC(year!, month! - 1, day!);
  let candidate = new Date(target);
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = zonedParts(candidate, timeZone);
    const represented = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    candidate = new Date(candidate.getTime() + (target - represented));
  }
  return candidate;
}

export function rescueDayWindow(now: Date, timeZone: string): { start: Date; end: Date } {
  const parts = zonedParts(now, timeZone);
  const periodKey = [parts.year, parts.month, parts.day]
    .map((value, index) => index === 0 ? String(value) : String(value).padStart(2, "0"))
    .join("-");
  const [year, month, day] = periodKey.split("-").map(Number);
  const nextPeriodKey = new Date(Date.UTC(year!, month! - 1, day! + 1)).toISOString().slice(0, 10);
  return {
    start: localMidnightUtc(periodKey, timeZone),
    end: localMidnightUtc(nextPeriodKey, timeZone),
  };
}

async function loadRescueQueue(
  organizationId: string,
  area: Exclude<RescueFilterArea, "overview">,
  filter: RescueFilter,
  now: Date,
): Promise<RescueQueueData> {
  if (area === "animals") {
    const rows = await prisma.animalProfile.findMany({
      where: { organizationId, lifecycleStatus: { in: ["in_care", "placement_ready"] } },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: QUEUE_LIMIT,
      select: { id: true, animalRef: true, name: true, species: true, lifecycleStatus: true, updatedAt: true },
    });
    return {
      title: "Animals currently in care",
      description: `Showing up to ${QUEUE_LIMIT} recently updated custody identities.`,
      rows: rows.map((row) => ({
        id: row.id,
        reference: row.animalRef,
        primary: row.name,
        detail: row.species,
        status: row.lifecycleStatus,
        occurredAt: row.updatedAt.toISOString(),
      })),
      limit: QUEUE_LIMIT,
      action: { label: "Open housing board", href: "/workspace/ward" },
    };
  }

  if (area === "intake") {
    const rows = await prisma.animalCustodyEpisode.findMany({
      where: filter === "legal-hold"
        ? { organizationId, closedAt: null, legalHoldActive: true }
        : { organizationId, closedAt: null, currentStage: "intake" },
      orderBy: [{ openedAt: "asc" }, { id: "asc" }],
      take: QUEUE_LIMIT,
      select: {
        id: true,
        episodeRef: true,
        currentStage: true,
        legalHoldActive: true,
        openedAt: true,
        animal: { select: { name: true, animalRef: true } },
      },
    });
    return {
      title: filter === "legal-hold" ? "Open legal holds" : "Animals awaiting intake review",
      description: `Showing up to ${QUEUE_LIMIT} open custody episodes.`,
      rows: rows.map((row) => ({
        id: row.id,
        reference: row.episodeRef,
        primary: row.animal.name,
        detail: row.animal.animalRef,
        status: row.legalHoldActive ? "legal-hold" : row.currentStage,
        occurredAt: row.openedAt.toISOString(),
      })),
      limit: QUEUE_LIMIT,
      action: { label: "Open housing board", href: "/workspace/ward" },
    };
  }

  if (area === "care") {
    const rows = await prisma.workEngagement.findMany({
      where: {
        organizationId,
        subjectKindSlug: "animal-profile",
        status: { notIn: ["completed", "cancelled", "failed"] },
        dueAt: filter === "missed" ? { lt: now } : { not: null },
      },
      orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      take: QUEUE_LIMIT,
      select: { id: true, title: true, status: true, subjectRef: true, dueAt: true },
    });
    return {
      title: filter === "missed" ? "Missed care work" : "Open care work",
      description: `Showing up to ${QUEUE_LIMIT} dated animal work items.`,
      rows: rows.map((row) => ({
        id: row.id,
        reference: row.subjectRef ?? row.id,
        primary: row.title,
        detail: row.subjectRef,
        status: row.status,
        occurredAt: row.dueAt?.toISOString() ?? null,
      })),
      limit: QUEUE_LIMIT,
      action: null,
    };
  }

  if (area === "adoptions" && filter === "no-interest") {
    const rows = await prisma.animalProfile.findMany({
      where: {
        organizationId,
        lifecycleStatus: "placement_ready",
        applications: { none: { status: { in: [...ACTIVE_APPLICATION_STATUSES] } } },
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: QUEUE_LIMIT,
      select: { id: true, animalRef: true, name: true, species: true, updatedAt: true },
    });
    return {
      title: "Placement-ready animals without interest",
      description: `Showing up to ${QUEUE_LIMIT} animals with no active application.`,
      rows: rows.map((row) => ({
        id: row.id,
        reference: row.animalRef,
        primary: row.name,
        detail: row.species,
        status: "no-active-application",
        occurredAt: row.updatedAt.toISOString(),
      })),
      limit: QUEUE_LIMIT,
      action: null,
    };
  }

  if (area === "adoptions") {
    const rows = await prisma.animalAdoptionApplication.findMany({
      where: { organizationId, status: { in: [...ACTIVE_APPLICATION_STATUSES] } },
      orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
      take: QUEUE_LIMIT,
      select: {
        id: true,
        applicationRef: true,
        status: true,
        submittedAt: true,
        animal: { select: { name: true, animalRef: true } },
      },
    });
    return {
      title: "Active adoption applications",
      description: `Showing up to ${QUEUE_LIMIT} oldest active applications.`,
      rows: rows.map((row) => ({
        id: row.id,
        reference: row.applicationRef,
        primary: row.animal.name,
        detail: row.animal.animalRef,
        status: row.status,
        occurredAt: row.submittedAt.toISOString(),
      })),
      limit: QUEUE_LIMIT,
      action: null,
    };
  }

  const rows = await prisma.financialFund.findMany({
    where: {
      organizationId,
      isActive: true,
      restriction: { in: ["temporarily_restricted", "permanently_restricted"] },
    },
    orderBy: [{ effectiveFrom: "asc" }, { id: "asc" }],
    take: QUEUE_LIMIT,
    select: { id: true, fundRef: true, name: true, purpose: true, restriction: true, effectiveFrom: true },
  });
  return {
    title: "Active restricted funds",
    description: `Showing up to ${QUEUE_LIMIT} restricted fund records.`,
    rows: rows.map((row) => ({
      id: row.id,
      reference: row.fundRef,
      primary: row.name,
      detail: row.purpose,
      status: row.restriction,
      occurredAt: row.effectiveFrom.toISOString(),
    })),
    limit: QUEUE_LIMIT,
    action: { label: "Open finance", href: "/finance" },
  };
}

/**
 * A bounded, read-only projection. Each lane reports unavailable independently;
 * one failed subsystem must not turn unknown data into a reassuring zero.
 */
export async function loadRescueCockpitData(
  organizationId: string,
  options: {
    area?: RescueFilterArea;
    filter?: RescueFilter;
    timeZone?: string;
    canViewFinance?: boolean;
    now?: Date;
  } = {},
) {
  const now = options.now ?? new Date();
  const asOf = now.toISOString();
  const timeZone = validTimeZone(options.timeZone ?? "UTC");
  const today = rescueDayWindow(now, timeZone);
  const area = options.area ?? "overview";
  const filter = options.filter ?? "all";
  const activeWork = { notIn: ["completed", "cancelled", "failed"] };
  const locale = await resolveOrgLocale(prisma as unknown as OrgLocaleClient);
  const observe = <T>(
    load: () => Promise<T>,
    isEmpty: (value: T) => boolean,
    unavailableReason: string,
  ) =>
    observeRescueSource({
      load,
      isEmpty,
      unavailableReason,
      asOf,
    });

  const results = await Promise.all([
    observe(async () => {
      const [inCare, intakeReview, legalHold, placementReady] = await Promise.all([
        prisma.animalProfile.count({ where: { organizationId, lifecycleStatus: { in: ["in_care", "placement_ready"] } } }),
        prisma.animalCustodyEpisode.count({ where: { organizationId, closedAt: null, currentStage: "intake" } }),
        prisma.animalCustodyEpisode.count({ where: { organizationId, closedAt: null, legalHoldActive: true } }),
        prisma.animalProfile.count({ where: { organizationId, lifecycleStatus: "placement_ready" } }),
      ]);
      return { inCare, intakeReview, legalHold, placementReady };
    }, (value) => value.inCare === 0, "Animal records could not be read."),
    observe(async () => {
      const board = await loadWardBoard({ organizationId, db: prisma as unknown as WardStoreClient });
      const summary = summarizeKennelCapacity(board);
      if (!summary) return { free: 0, blocked: 0 };
      return { free: summary.free, blocked: summary.outOfService };
    }, (value) => value.free === 0 && value.blocked === 0, "Housing capacity could not be read."),
    observe(async () => {
      const [dueToday, missed, exceptions] = await Promise.all([
        prisma.workEngagement.count({ where: { organizationId, subjectKindSlug: "animal-profile", status: activeWork, dueAt: { gte: today.start, lt: today.end } } }),
        prisma.workEngagement.count({ where: { organizationId, subjectKindSlug: "animal-profile", status: activeWork, dueAt: { lt: now } } }),
        prisma.careRecord.count({ where: { organizationId, subjectKindSlug: "animal-profile", lifecycle: "active", legalHold: true } }),
      ]);
      return { dueToday, missed, exceptions };
    }, (value) => value.dueToday === 0 && value.missed === 0 && value.exceptions === 0, "Daily care records could not be read."),
    observe(async () => {
      const [activeApplications, readyWithoutInterest] = await Promise.all([
        prisma.animalAdoptionApplication.count({ where: { organizationId, status: { in: [...ACTIVE_APPLICATION_STATUSES] } } }),
        prisma.animalProfile.count({ where: { organizationId, lifecycleStatus: "placement_ready", applications: { none: { status: { in: [...ACTIVE_APPLICATION_STATUSES] } } } } }),
      ]);
      return { activeApplications, readyWithoutInterest };
    }, (value) => value.activeApplications === 0 && value.readyWithoutInterest === 0, "Adoption records could not be read."),
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
          where: {
            currency: locale.currency,
            subjectKindSlug: "animal-profile",
            journalEntry: { organizationId, status: "posted" },
          },
          _sum: { debit: true, credit: true },
        }),
      ]);
      const postedAnimalCost = Number(animalCost._sum.debit ?? 0) - Number(animalCost._sum.credit ?? 0);
      return { restrictedFunds, postedAnimalCost };
    }, (value) => value.restrictedFunds === 0 && value.postedAnimalCost === 0, "Stewardship records could not be read.") : Promise.resolve(sourceUnavailable("Finance access is required.", asOf)),
  ]);
  const [animals, capacity, care, adoptions, stewardship] = results as [
    RescueSources["animals"],
    RescueSources["capacity"],
    RescueSources["care"],
    RescueSources["adoptions"],
    RescueSources["stewardship"],
  ];

  const queue = area === "overview"
    ? null
    : area === "stewardship" && !options.canViewFinance
      ? sourceUnavailable<RescueQueueData>("Finance access is required.", asOf)
      : await observeRescueSource({
          load: () => loadRescueQueue(organizationId, area, filter, now),
          isEmpty: (value) => value.rows.length === 0,
          unavailableReason: `${area[0]!.toUpperCase()}${area.slice(1)} records could not be read.`,
          asOf,
        });
  return {
    ...buildRescueCockpit({ animals, capacity, care, adoptions, stewardship }),
    queue,
    presentation: {
      asOf,
      currency: locale.currency,
      locale: locale.locale,
      timeZone,
    },
  };
}
