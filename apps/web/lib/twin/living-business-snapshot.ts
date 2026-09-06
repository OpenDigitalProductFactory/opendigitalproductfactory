// apps/web/lib/twin/living-business-snapshot.ts
//
// The live projection for the operational twin (EP-LIVING-BUSINESS-VIZ P3,
// increment 2 — data). Reads a running org's real substrate and produces a
// `TwinSnapshot` — the exact shape `demo-snapshot.ts` invents — so `TwinView`
// renders live where the data exists and the demo fills in only where a live
// source genuinely does not (yet).
//
// Honesty policy (parent spec §4, "staff = work owned"): every field here is
// backed by a real query or clearly derived from one. Where no substrate exists
// yet — a persisted human+AI event log, per-stage flow metrics, a live cog
// optimizer — the field is left empty (with its calm-state label) or omitted
// rather than faked. Those become the next increments, behind this same shape.
//
// DPF is single-org-per-deployment: "the org" is the one `StorefrontConfig` row.

import {
  deriveTwinProfile,
  deriveTwinValueStreamBinding,
  type TwinProfile,
} from "@dpf/storefront-templates";

import { buildStageFlow, type StageDemand } from "./stage-flow";
import {
  daysBetween,
  humanizeWait,
  isWalkInWait,
  moneyToNumber,
  statusIntent,
  titleCase,
} from "./operations-format";
import {
  bookingsToQueueItems,
  longestWaitMs,
} from "./booking-queue-projection";
import { activeAwarePresence, loadTwinWorkforceView } from "./live-workforce-activity";
import type { LiveTwinSnapshot } from "./operations-snapshot";
import {
  createOperationsLoadRuntime,
  type OperationsProjectionDiagnostics,
} from "./operations-load-runtime";
import {
  hospitalityResourceUnits,
  isReservationQueueKey,
  isUpcomingReservation,
  readinessQuest,
  reservationsToQueueItems,
  restaurantCapacityChips,
  restaurantFloorResourceUnits,
} from "./restaurant-operations-projection";
import {
  buildOutcomeProjectionFromFacts,
  loadArchetypeOutcomeFacts,
  type ArchetypeOutcomeFactsClient,
} from "./archetype-outcome-facts";
import {
  resolveTemplateDefinition,
  templateOperatingWindows,
} from "./archetype-operating-profile";

import {
  deriveRestaurantCapacity,
  resolveServicePeriod,
  type CapacityBookingInput,
  type CapacityAllocationInput,
  type CapacityResourceInput,
  type RestaurantCapacitySnapshot,
} from "@/lib/storefront/restaurant-capacity";

import type { Intent } from "@/components/ui/report-kit";
import {
  formatMoney,
  resolveOrgLocale,
  type OrgLocaleClient,
  type OrgLocaleSettings,
} from "@/lib/org-locale/org-locale";
import {
  loadWorkforceRoster,
  type WorkforceMember,
  type WorkforceRosterClient,
} from "@/lib/workforce/workforce-roster";
import type {
  CapacityChipData,
  FeedEventData,
  QuestData,
  ResourceUnitData,
  TwinActor,
  TwinCogSnapshot,
  TwinQueueSnapshot,
  TwinZoneSnapshot,
  UtilityMeterData,
  WorkItemData,
} from "@/components/twin";

// ── Structural client (satisfied by the real PrismaClient and by test fakes) ──
type FindMany = (args: unknown) => Promise<unknown>;
export type LivingBusinessClient = WorkforceRosterClient &
  OrgLocaleClient &
  ArchetypeOutcomeFactsClient & {
    storefrontConfig: { findFirst: (args: unknown) => Promise<unknown> };
    bill: { findMany: FindMany };
    /** Optional — outcomes (paid-invoice revenue) degrade to empty if absent. */
    invoice?: { findMany: FindMany };
    taxObligationPeriod: { findMany: FindMany };
    obligation: { findMany: FindMany };
    storefrontBooking: { findMany: FindMany };
    serviceProvider: { findMany: FindMany };
    hospitalityResource: { findMany: FindMany };
    hospitalityCapacityAllocation: { findMany: FindMany };
    /** Optional — live workforce-activity read (BI-FB233706); degrades if absent. */
    taskRun?: { findMany: FindMany };
  };

// ── Row shapes we select (kept narrow; amounts may arrive as Prisma.Decimal) ──
type Money = number | string | { toString(): string } | null;
interface BillRow {
  amountDue: Money;
  dueDate: Date | null;
  status: string;
  currency: string | null;
}
interface TaxPeriodRow {
  dueDate: Date | null;
  status: string;
  filedAt: Date | null;
}
interface ObligationRow {
  status: string;
  reviewDate: Date | null;
}
interface BookingRow {
  id: string;
  /** Present on the live query (selected); optional so pure-helper test fixtures
   *  that exercise only provider-name behaviour need not supply it. */
  providerId?: string | null;
  hospitalityResourceId?: string | null;
  scheduledAt: Date | null;
  createdAt: Date | null;
  status: string;
  provider: { name: string } | null;
}
interface ProviderRow {
  id: string;
  name: string;
  isActive: boolean;
}
interface HospitalityResourceRow {
  id: string;
  label: string;
  kind: CapacityResourceInput["kind"];
  status: CapacityResourceInput["status"];
  capacity: number;
  capacityUnit: CapacityResourceInput["capacityUnit"];
  availability: NonNullable<CapacityResourceInput["availability"]>;
}
interface HospitalityAllocationRow {
  id: string;
  resourceId: string | null;
  startsAt: Date;
  endsAt: Date;
  lifecycle: CapacityAllocationInput["lifecycle"];
}
interface InvoiceRow {
  totalAmount: Money;
  currency: string | null;
}

export type { LiveTwinSnapshot } from "./operations-snapshot";
export { humanizeWait, statusIntent } from "./operations-format";
export {
  bookingsToQueueItems,
  isReservationQueueKey,
  isUpcomingReservation,
  longestWaitMs,
  readinessQuest,
  reservationsToQueueItems,
  restaurantCapacityChips,
};

// ─────────────────────────── pure mapping helpers ───────────────────────────

/** Humans + AI coworkers on one plane — the roster IS the presence row. Thin
 *  wrapper over `activeAwarePresence` with no active work (identical output). */
export function rosterToPresence(members: WorkforceMember[], limit = 8): TwinActor[] {
  return activeAwarePresence(members, [], new Date(0), { limit });
}

/**
 * The countable resource units. Prefer real service providers (the archetype's
 * service capacity); otherwise the workforce itself is the resource
 * ("staff = work owned"). Never invents units.
 */
export function resourceUnits(
  providers: ProviderRow[],
  members: WorkforceMember[],
  limit = 12,
): ResourceUnitData[] {
  if (providers.length > 0) {
    return providers.slice(0, limit).map((p) => ({
      key: p.id,
      label: p.name,
      state: p.isActive ? "Available" : "Off",
      intent: p.isActive ? "success" : "neutral",
    }));
  }
  return members
    .filter((m) => m.status.toLowerCase() !== "archived")
    .slice(0, limit)
    .map((m) => ({
      key: m.id,
      label: m.displayName,
      state: titleCase(m.status),
      intent: statusIntent(m.status),
      owner: m.kind === "agent" ? { name: m.displayName, kind: "ai" } : undefined,
    }));
}

/** In-flight demand → work items, attributed to the assigned provider (human). */
export function bookingsToWorkItems(bookings: BookingRow[], workNoun: string, limit = 5): WorkItemData[] {
  return bookings
    .filter((b) => ["confirmed", "scheduled", "in_progress", "inprogress"].includes(b.status.toLowerCase()))
    .slice(0, limit)
    .map((b) => ({
      key: b.id,
      label: `${titleCase(workNoun)}${b.provider?.name ? ` · ${b.provider.name}` : ""}`,
      owner: b.provider?.name ? { name: b.provider.name, kind: "human" } : undefined,
      sublabel: b.scheduledAt ? b.scheduledAt.toISOString().slice(0, 10) : undefined,
    }));
}

/** The supporting-activity meters — all backed by the finance spine. */
export function financeToUtility(input: {
  billsDueCount: number;
  billsDueAmount: number;
  currency: string | null;
  locale?: string | null;
  nextTaxDueDays: number | null;
  complianceOpenCount: number;
  coworkerGaps: number;
}): UtilityMeterData[] {
  const taxIntent: Intent =
    input.nextTaxDueDays == null
      ? "success"
      : input.nextTaxDueDays <= 7
        ? "danger"
        : input.nextTaxDueDays <= 14
          ? "warning"
          : "info";
  return [
    {
      key: "bills",
      label: "Bills due",
      value:
        input.billsDueCount > 0
          ? `${input.billsDueCount} · ${formatMoney(input.billsDueAmount, input.currency, input.locale)}`
          : "None due",
      intent: input.billsDueCount > 0 ? "warning" : "success",
      hint: "Next 7 days",
    },
    {
      key: "tax",
      label: "Tax filing",
      value: input.nextTaxDueDays == null ? "Up to date" : `${input.nextTaxDueDays} days`,
      intent: taxIntent,
    },
    {
      key: "compliance",
      label: "Compliance",
      value: input.complianceOpenCount > 0 ? `${input.complianceOpenCount} to review` : "All clear",
      intent: input.complianceOpenCount > 0 ? "warning" : "success",
    },
    {
      key: "improve",
      label: "Coworker gaps",
      value: input.coworkerGaps > 0 ? `${input.coworkerGaps} to close` : "None",
      intent: input.coworkerGaps > 0 ? "accent" : "success",
    },
  ];
}

/** What genuinely needs a human — every quest is a real attention signal. */
export function buildQuests(input: {
  billsDueCount: number;
  nextTaxDueDays: number | null;
  unassignedCount: number;
}): QuestData[] {
  const quests: QuestData[] = [];
  if (input.nextTaxDueDays != null && input.nextTaxDueDays <= 14) {
    quests.push({
      key: "tax",
      title: `Tax filing due in ${input.nextTaxDueDays} days`,
      detail: "Review and submit the next return",
      intent: input.nextTaxDueDays <= 7 ? "danger" : "warning",
      cta: "Review",
    });
  }
  if (input.unassignedCount > 0) {
    quests.push({
      key: "unassigned",
      title: `${input.unassignedCount} unassigned`,
      detail: "Demand waiting to be routed to a resource",
      intent: "warning",
      cta: "Assign",
    });
  }
  if (input.billsDueCount > 0) {
    quests.push({
      key: "bills",
      title: `${input.billsDueCount} bill${input.billsDueCount === 1 ? "" : "s"} due this week`,
      detail: "Approve or schedule payment",
      intent: "warning",
      cta: "Pay",
    });
  }
  return quests;
}

/** Live, archetype-agnostic capacity counters — each is a true number. When any
 *  demand is waiting, the longest wait leads as the headline flow metric. */
export function liveCapacityChips(input: {
  teamTotal: number;
  aiCount: number;
  openDemand: number;
  billsDueCount: number;
  longestWaitMs?: number;
}): CapacityChipData[] {
  const chips: CapacityChipData[] = [];
  if (input.longestWaitMs && input.longestWaitMs > 0) {
    chips.push({
      key: "wait",
      label: "Longest wait",
      value: humanizeWait(input.longestWaitMs),
      intent: input.longestWaitMs > 86_400_000 ? "danger" : "warning",
      live: true,
    });
  }
  chips.push(
    { key: "team", label: "Workforce", value: input.teamTotal, intent: "info", live: true },
    { key: "ai", label: "AI coworkers", value: input.aiCount, intent: "accent" },
    { key: "demand", label: "Open demand", value: input.openDemand, intent: input.openDemand > 0 ? "warning" : "success", live: true },
    { key: "bills", label: "Bills due", value: input.billsDueCount, intent: input.billsDueCount > 0 ? "warning" : "success" },
  );
  return chips;
}

/**
 * The cog's live allocation proposal — the real `constraint → proposal → confirm`
 * loop the founder asked for ("a suggested table seating cog"). Takes the
 * longest-waiting unassigned demand and proposes the least-loaded active resource
 * (fewest in-flight items), naming the actual item + resource. Returns `undefined`
 * when there is nothing to allocate — the cog only speaks when it has a real move.
 */
export function proposeCogAllocation(
  bookings: BookingRow[],
  providers: ProviderRow[],
  members: WorkforceMember[],
  workNoun: string,
  resourceNoun: string,
  signals: string[],
  now: Date,
): TwinCogSnapshot | undefined {
  const next = bookings
    .filter((b) => b.status.toLowerCase() === "pending" || b.provider == null)
    .sort((a, b) => (a.createdAt?.getTime() ?? Infinity) - (b.createdAt?.getTime() ?? Infinity))[0];
  if (!next) return undefined;

  // In-flight load per named resource, from the bookings already assigned.
  const load = new Map<string, number>();
  for (const b of bookings) {
    if (b.provider?.name) load.set(b.provider.name, (load.get(b.provider.name) ?? 0) + 1);
  }

  let resource: string | undefined;
  if (providers.length > 0) {
    resource = [...providers].sort(
      (a, b) => (load.get(a.name) ?? 0) - (load.get(b.name) ?? 0),
    )[0]?.name;
  } else {
    const active = members.filter((m) => m.status.toLowerCase() === "active");
    resource = (active.find((m) => m.kind === "agent") ?? active[0])?.displayName;
  }

  // Only prefix a "waiting" descriptor for a genuine walk-in wait — a scheduled
  // reservation's age is not a wait, so the cog says "the next ticket", not "the
  // 3d-waiting ticket".
  const waited =
    isWalkInWait(next) && next.createdAt ? humanizeWait(now.getTime() - next.createdAt.getTime()) : null;
  return {
    proposal: resource
      ? `Assign the ${waited ? `${waited}-waiting ` : "next "}${workNoun} to ${resource} (lowest load)`
      : `Route the longest-waiting ${workNoun} to an available ${resourceNoun}`,
    confirmLabel: `Assign ${workNoun}`,
    signals: signals.slice(0, 3),
  };
}

/** A bounded attributed feed from the demand rows we already read. The persisted
 *  human+AI event log (parent spec §4 live-delta plane) is a later increment; for
 *  now the feed reflects real booking activity, attributed to its provider. */
export function bookingsToFeed(bookings: BookingRow[], workNoun: string, limit = 4): FeedEventData[] {
  return bookings.slice(0, limit).map((b, i) => ({
    key: `bk-${b.id}-${i}`,
    actor: b.provider?.name ? { name: b.provider.name, kind: "human" } : { name: "Front desk", kind: "human" },
    action: `${b.status.toLowerCase() === "pending" ? "took a new" : "is handling a"} ${workNoun}`,
    at: b.scheduledAt ? b.scheduledAt.toISOString().slice(5, 10) : undefined,
  }));
}

// ─────────────────────────────── the loader ────────────────────────────────

export interface LivingBusinessLoadOptions {
  db?: LivingBusinessClient;
  now?: Date;
  clock?: () => number;
}

/**
 * Load the live twin snapshot for the deployment's single org. Returns `null`
 * when no org is configured (or its archetype has no template definition) — the
 * caller falls back to `buildDemoTwinSnapshot`. Mirrors the `platform-loader`
 * idiom: injected client, `Promise.all` fan-out, fail-soft reads.
 */
export async function loadLivingBusinessProjection(
  opts?: LivingBusinessLoadOptions,
): Promise<{ twin: LiveTwinSnapshot; diagnostics: OperationsProjectionDiagnostics } | null> {
  const clock = opts?.clock ?? (() => performance.now());
  const rawDb = opts?.db ?? ((await import("@dpf/db")).prisma as unknown as LivingBusinessClient);
  const now = opts?.now ?? new Date();
  const observedAt = now.toISOString();
  const runtime = createOperationsLoadRuntime({ client: rawDb, observedAt, clock });
  const db = runtime.client;
  const in7 = new Date(now.getTime() + 7 * 86_400_000);

  const config = (await db.storefrontConfig.findFirst({
    select: {
      id: true,
      organizationId: true,
      timezone: true,
      archetype: { select: { archetypeId: true, name: true } },
    },
  })) as {
    id: string;
    organizationId: string;
    timezone: string;
    archetype: { archetypeId: string; name: string } | null;
  } | null;
  runtime.observe("configuration");

  const archetypeId = config?.archetype?.archetypeId;
  if (!archetypeId) return null;
  const def = resolveTemplateDefinition(archetypeId);
  if (!def) return null;

  const profile: TwinProfile = deriveTwinProfile(def);

  const in90 = new Date(now.getTime() - 90 * 86_400_000);
  let localeReadFailed = false;
  const [
    roster,
    bills,
    taxPeriods,
    obligations,
    bookings,
    providers,
    hospitalityResources,
    hospitalityAllocations,
    paidInvoices,
    orgLocale,
    outcomeFacts,
  ] = await Promise.all([
    runtime.read(
      "workforce",
      loadWorkforceRoster({ db }),
      { members: [], summary: { total: 0, humans: 0, agents: 0, agentsWithUnmetNeeds: 0 } },
    ),
    runtime.read(
      "bills",
      db.bill.findMany({
        where: { status: { notIn: ["paid", "void"] }, dueDate: { gte: now, lte: in7 } },
        select: { amountDue: true, dueDate: true, status: true, currency: true },
      }) as Promise<BillRow[]>,
      [],
    ),
    runtime.read(
      "tax",
      db.taxObligationPeriod.findMany({
        where: { filedAt: null },
        orderBy: { dueDate: "asc" },
        take: 1,
        select: { dueDate: true, status: true, filedAt: true },
      }) as Promise<TaxPeriodRow[]>,
      [],
    ),
    runtime.read(
      "obligations",
      db.obligation.findMany({
        where: { status: "active" },
        select: { status: true, reviewDate: true },
      }) as Promise<ObligationRow[]>,
      [],
    ),
    runtime.read(
      "bookings",
      db.storefrontBooking.findMany({
        where: { status: { notIn: ["completed", "cancelled"] } },
        orderBy: { scheduledAt: "asc" },
        take: 24,
        select: {
          id: true,
          providerId: true,
          hospitalityResourceId: true,
          scheduledAt: true,
          createdAt: true,
          status: true,
          provider: { select: { name: true } },
        },
      }) as Promise<BookingRow[]>,
      [],
    ),
    runtime.read(
      "resources",
      db.serviceProvider.findMany({
        where: { isActive: true },
        take: 12,
        select: { id: true, name: true, isActive: true },
      }) as Promise<ProviderRow[]>,
      [],
    ),
    runtime.read(
      "hospitality-capacity",
      db.hospitalityResource.findMany({
        where: { kind: "table" },
        take: 12,
        select: {
          id: true,
          label: true,
          kind: true,
          status: true,
          capacity: true,
          capacityUnit: true,
          availability: {
            select: {
              kind: true,
              days: true,
              startTime: true,
              endTime: true,
              date: true,
            },
          },
        },
      }) as Promise<HospitalityResourceRow[]>,
      [],
    ),
    runtime.read(
      "hospitality-allocations",
      db.hospitalityCapacityAllocation.findMany({
        where: {
          resourceId: { not: null },
          lifecycle: { in: ["reserved", "active"] },
          startsAt: { lte: now },
          endsAt: { gt: now },
        },
        take: 48,
        select: {
          id: true,
          resourceId: true,
          startsAt: true,
          endsAt: true,
          lifecycle: true,
        },
      }) as Promise<HospitalityAllocationRow[]>,
      [],
    ),
    db.invoice?.findMany
      ? runtime.read(
          "invoices",
          db.invoice.findMany({
            where: { paidAt: { not: null, gte: in90 } },
            select: { totalAmount: true, currency: true },
          }) as Promise<InvoiceRow[]>,
          [],
        )
      : (runtime.unavailable("invoices"), Promise.resolve([])),
    resolveOrgLocale(db, {
      onReadFailure: () => {
        localeReadFailed = true;
      },
    }),
    loadArchetypeOutcomeFacts({
      archetypeId,
      storefrontId: config.id,
      organizationId: config.organizationId,
      since: in90,
      db,
      runtime,
    }),
  ]);
  if (localeReadFailed) runtime.degrade("locale");
  else runtime.observe("locale");

  const members = roster.members;
  const billsDueAmount = bills.reduce((sum, b) => sum + moneyToNumber(b.amountDue), 0);
  // The org's own currency + locale (from OrgSettings, derived from the operator's
  // country) is authoritative for every money surface here — never inferred from
  // whichever bill/invoice row happened to carry a currency.
  const { currency: orgCurrency, locale: orgLocaleStr } = orgLocale as OrgLocaleSettings;
  const nextTaxDueDays =
    taxPeriods[0]?.dueDate != null ? Math.max(0, daysBetween(now, taxPeriods[0].dueDate)) : null;
  const complianceOpenCount = obligations.filter(
    (o) => o.reviewDate != null && o.reviewDate.getTime() <= in7.getTime(),
  ).length;
  const unassigned = bookings.filter((b) => b.provider == null || b.status.toLowerCase() === "pending");

  // FLOOR (Restaurant) capacity: derive one snapshot from the SAME structured
  // hospitality resources +
  // bookings this projection already loaded, so the Workspace capacity chips,
  // reservations queue, and readiness answer reconcile with the Storefront
  // Tables & Capacity page and inbox (BI-7C95A586 / BI-348766E5). The workspace
  // capacity facts used by the Tables page.
  const floorSnapshot: RestaurantCapacitySnapshot | null =
    profile.template === "FLOOR"
      ? deriveRestaurantCapacity({
          resources: hospitalityResources,
          bookings: bookings.map(
            (b): CapacityBookingInput => ({
              id: b.id,
              hospitalityResourceId: b.hospitalityResourceId ?? null,
              scheduledAt: b.scheduledAt,
              durationMinutes: null, // default turn (90m) applied by the projection
              status: b.status,
            }),
          ),
          allocations: hospitalityAllocations,
          now,
          nextPeriod: resolveServicePeriod(templateOperatingWindows(def), now),
          timeZone: config.timezone,
        })
      : null;

  // Render the resource units under the zone that actually holds them
  // (`capacityZoneKey`) — a restaurant's tables belong in the dining room, not
  // "Kitchen / the pass"; a shop's work orders on the bays, not at intake. FLOOR
  // must use the derived capacity snapshot so occupied/turning tables do not
  // regress to "Available" merely because the resource itself is active.
  const zones: TwinZoneSnapshot[] = [
    {
      key: profile.capacityZoneKey ?? profile.zones[0]?.key ?? "board",
      units:
        profile.template === "FLOOR" && floorSnapshot
          ? restaurantFloorResourceUnits(floorSnapshot)
          : profile.template === "FLOOR"
            ? hospitalityResourceUnits(hospitalityResources)
            : resourceUnits(providers, members),
    },
  ];

  // Distribute booking-derived demand across the profile's queues by MEANING, not
  // just into queue 0. A profile with a dedicated reservations queue (e.g. the
  // restaurant FLOOR: [waitlist, reservations]) must show its upcoming reservations
  // there instead of a hardcoded-empty "Reservations 0 / Clear" that contradicts the
  // Storefront booking history (BI-348766E5 fix 3). Guarded so profiles whose FIRST
  // queue is the reservations queue (YARD) — and every non-reservation profile —
  // keep their existing behaviour exactly.
  const reservationQueuePresent = profile.queues.some((qs, i) => i > 0 && isReservationQueueKey(qs.key));
  const upcomingReservationItems = reservationQueuePresent
    ? reservationsToQueueItems(bookings, now)
    : [];
  // Keep the general (index 0) queue from double-counting the upcoming reservations
  // now shown in their own queue.
  const generalBookings = reservationQueuePresent
    ? bookings.filter((b) => !isUpcomingReservation(b, now))
    : bookings;
  const generalQueueItems = bookingsToQueueItems(generalBookings, now);
  const queues: TwinQueueSnapshot[] = profile.queues.map((qs, i) => {
    if (i > 0 && isReservationQueueKey(qs.key)) {
      return { key: qs.key, items: upcomingReservationItems, emptyLabel: "No upcoming reservations" };
    }
    return {
      key: qs.key,
      items: i === 0 ? generalQueueItems : [],
      emptyLabel: i === 0 ? "No demand waiting" : "Clear",
    };
  });

  const cog = proposeCogAllocation(
    bookings,
    providers,
    members,
    profile.workItemNoun.singular,
    profile.resourceNoun.singular,
    profile.cog.signals,
    now,
  );

  // Value-stream flow lane (workstream C): live demand grouped by its stage.
  // Waiting (pending / unassigned) demand sits at the primary stage; work in
  // progress has moved to Deliver.
  const binding = deriveTwinValueStreamBinding(def);
  const deliverStage = binding.stages.some((s) => s.stageKey === "deliver")
    ? "deliver"
    : binding.primaryStageKey;
  const stageDemand: Record<string, StageDemand> = {};
  for (const b of bookings) {
    const waiting = b.status.toLowerCase() === "pending" || b.provider == null;
    const stage = waiting ? binding.primaryStageKey : deliverStage;
    // Same rule as the headline chip: only an unscheduled walk-in's age is a real
    // wait, so a stage of scheduled reservations shows a count without a bogus
    // multi-day "longest wait" badge.
    const waitMs =
      waiting && isWalkInWait(b) && b.createdAt ? Math.max(0, now.getTime() - b.createdAt.getTime()) : 0;
    const cur = stageDemand[stage] ?? { count: 0, longestWaitMs: 0 };
    cur.count += 1;
    cur.longestWaitMs = Math.max(cur.longestWaitMs ?? 0, waitMs);
    stageDemand[stage] = cur;
  }
  const stageFlow = buildStageFlow(binding, stageDemand);

  // Outcomes (workstream D): the archetype decides what proof of value means.
  // Rescue aggregates come only from canonical donation/adoption records; the
  // missing foster source remains explicitly unavailable rather than fabricated.
  const paidRevenue = paidInvoices.reduce((sum, inv) => sum + moneyToNumber(inv.totalAmount), 0);
  const outcomeProjection = buildOutcomeProjectionFromFacts({
    archetypeId,
    currency: orgCurrency,
    locale: orgLocaleStr,
    paidRevenue,
    deliveredJobs: paidInvoices.length,
    facts: outcomeFacts,
  });

  // For a restaurant, the headline answers "are we ready for the next service
  // period?" with capacity in its own words + one next action ahead of the
  // generic finance/tax quests.
  const genericQuests = buildQuests({
    billsDueCount: bills.length,
    nextTaxDueDays,
    unassignedCount: unassigned.length,
  });
  const quests: QuestData[] = floorSnapshot
    ? [readinessQuest(floorSnapshot), ...genericQuests].filter((q): q is QuestData => q != null)
    : genericQuests;

  // Real coworker activity (BI-FB233706): presence shows who is working on what;
  // the feed leads with real coworker activity. Fail-soft; read via rawDb.
  const workforceView = await loadTwinWorkforceView({
    client: rawDb,
    members,
    now,
    demandFeed: bookingsToFeed(bookings, profile.workItemNoun.singular),
  });

  const twin: LiveTwinSnapshot = {
    live: true,
    archetypeId,
    archetypeName: config?.archetype?.name ?? def.name,
    template: profile.template,
    capacityChips: floorSnapshot
      ? restaurantCapacityChips(floorSnapshot)
      : liveCapacityChips({
          teamTotal: roster.summary.total,
          aiCount: roster.summary.agents,
          openDemand: bookings.length,
          billsDueCount: bills.length,
          longestWaitMs: longestWaitMs(bookings, now),
        }),
    stageFlow,
    outcomes: outcomeProjection.outcomes,
    outcomesHeading: outcomeProjection.heading,
    zones,
    workItems: bookingsToWorkItems(bookings, profile.workItemNoun.singular),
    queues,
    cog,
    presence: workforceView.presence,
    feed: workforceView.feed,
    quests,
    utility: financeToUtility({
      billsDueCount: bills.length,
      billsDueAmount,
      currency: orgCurrency,
      locale: orgLocaleStr,
      nextTaxDueDays,
      complianceOpenCount,
      coworkerGaps: roster.summary.agentsWithUnmetNeeds,
    }),
  };
  return { twin, diagnostics: runtime.complete() };
}

/**
 * Compatibility facade for existing TwinView callers. New Operations surfaces
 * consume `loadVersionedOperationsSnapshot` and one bounded selector.
 */
export async function loadLivingBusinessSnapshot(
  opts?: LivingBusinessLoadOptions,
): Promise<LiveTwinSnapshot | null> {
  const loaded = await loadLivingBusinessProjection(opts);
  return loaded?.twin ?? null;
}
