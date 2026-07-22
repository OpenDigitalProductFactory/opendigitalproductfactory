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
  ALL_ARCHETYPES,
  deriveTwinProfile,
  deriveTwinValueStreamBinding,
  type ArchetypeDefinition,
  type TwinProfile,
  type TwinTemplate,
} from "@dpf/storefront-templates";

import { buildStageFlow, type StageDemand } from "./stage-flow";

import {
  deriveRestaurantCapacity,
  resolveServicePeriod,
  readinessHeadline,
  type CapacityBookingInput,
  type CapacityResourceInput,
  type OperatingWindow,
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
  QueueItemData,
  ResourceUnitData,
  TwinActor,
  TwinCogSnapshot,
  TwinOutcome,
  TwinQueueSnapshot,
  TwinSnapshot,
  TwinZoneSnapshot,
  UtilityMeterData,
  WorkItemData,
} from "@/components/twin";

// ── Structural client (satisfied by the real PrismaClient and by test fakes) ──
type FindMany = (args: unknown) => Promise<unknown>;
export type LivingBusinessClient = WorkforceRosterClient & OrgLocaleClient & {
  storefrontConfig: { findFirst: (args: unknown) => Promise<unknown> };
  bill: { findMany: FindMany };
  /** Optional — outcomes (paid-invoice revenue) degrade to empty if absent. */
  invoice?: { findMany: FindMany };
  taxObligationPeriod: { findMany: FindMany };
  obligation: { findMany: FindMany };
  storefrontBooking: { findMany: FindMany };
  serviceProvider: { findMany: FindMany };
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
interface InvoiceRow {
  totalAmount: Money;
  currency: string | null;
}

export interface LiveTwinSnapshot extends TwinSnapshot {
  live: true;
  archetypeId: string;
  archetypeName: string;
  template: TwinTemplate;
}

// ── small pure utilities ──
function toNum(v: Money): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  const n = Number(typeof v === "string" ? v : v.toString());
  return Number.isFinite(n) ? n : 0;
}
function titleCase(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}
function daysBetween(from: Date, to: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / 86_400_000);
}
/** Humanize an elapsed duration for a queue-wait chip ("8m", "3h", "2d"). */
export function humanizeWait(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h`;
  return `${Math.round(hrs / 24)}d`;
}
/** "07-16" — a compact month-day from an ISO date. */
function monthDay(d: Date): string {
  return d.toISOString().slice(5, 10);
}
/**
 * A pending item is only genuinely *waiting* — a live queue wait measured from
 * when it landed — when it has NO scheduled slot (a walk-in / unrouted request).
 * A reservation with a scheduled time is *upcoming* (or, once that slot passes
 * unfulfilled, *overdue*), never a multi-day "wait". This is what stops a
 * restaurant from reporting a nonsensical "3-day wait" on a booking row that was
 * simply created three days ago for a since-passed sitting.
 */
function isWalkInWait(b: { scheduledAt: Date | null }): boolean {
  return b.scheduledAt == null;
}
// Money formatting + the org's currency/locale now come from the shared
// `@/lib/org-locale` spine (EP-ORG-LOCALE-CURRENCY) so the twin renders the
// org's real currency (from OrgSettings, derived from the operator's country)
// instead of inferring it from whichever bill row happened to carry one.

// ─────────────────────────── pure mapping helpers ───────────────────────────

/** State → intent for a resource unit / booking. */
export function statusIntent(status: string): Intent {
  const s = status.toLowerCase();
  if (["active", "confirmed", "completed", "paid", "healthy"].some((k) => s.includes(k))) return "success";
  if (["pending", "scheduled", "in_progress", "inprogress", "onboarding"].some((k) => s.includes(k))) return "info";
  if (["overdue", "failed", "at_risk", "at-risk", "blocked", "cancelled"].some((k) => s.includes(k))) return "danger";
  if (["hold", "review", "draft", "stale", "watch"].some((k) => s.includes(k))) return "warning";
  return "neutral";
}

/** Humans + AI coworkers on one plane — the roster IS the presence row. */
export function rosterToPresence(members: WorkforceMember[], limit = 8): TwinActor[] {
  return members
    .filter((m) => m.status.toLowerCase() !== "archived" && m.status.toLowerCase() !== "inactive")
    // AI coworkers first (they're the differentiator), then humans.
    .sort((a, b) => Number(b.kind === "agent") - Number(a.kind === "agent"))
    .slice(0, limit)
    .map((m) => ({
      name: m.displayName,
      kind: m.kind === "agent" ? "ai" : "human",
      focus: m.role ?? undefined,
    }));
}

/**
 * The countable resource units. Prefer real service providers (the archetype's
 * service capacity); otherwise the workforce itself is the resource
 * ("staff = work owned"). Never invents units.
 */
export function resourceUnits(
  providers: ProviderRow[],
  members: WorkforceMember[],
  limit = 8,
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

/** Pending, unstarted demand → queue items with a REAL wait time (age in the
 *  queue, measured from when the booking was created — the flow metric the founder
 *  asked for: "if we know the queue and wait times"). Ordered longest-waiting first. */
export function bookingsToQueueItems(bookings: BookingRow[], now: Date, limit = 6): QueueItemData[] {
  return bookings
    .filter((b) => b.status.toLowerCase() === "pending" || b.provider == null)
    .sort((a, b) => (a.createdAt?.getTime() ?? Infinity) - (b.createdAt?.getTime() ?? Infinity))
    .slice(0, limit)
    .map((b) => {
      const label = b.provider?.name ? `With ${b.provider.name}` : "Unassigned";
      // Upcoming reservation — the meaningful metric is time-until, not age.
      if (b.scheduledAt && b.scheduledAt.getTime() > now.getTime()) {
        return {
          key: b.id,
          label,
          meta: `booked for ${monthDay(b.scheduledAt)}`,
          waiting: `in ${humanizeWait(b.scheduledAt.getTime() - now.getTime())}`,
        };
      }
      // Scheduled slot has passed and it is still unfulfilled — overdue, not waiting.
      if (b.scheduledAt) {
        return { key: b.id, label, meta: `overdue · was ${monthDay(b.scheduledAt)}` };
      }
      // Walk-in / unrouted request — a genuine live queue wait from when it landed.
      return {
        key: b.id,
        label,
        meta: "awaiting schedule",
        waiting: b.createdAt ? humanizeWait(now.getTime() - b.createdAt.getTime()) : undefined,
      };
    });
}

/**
 * Restaurant (FLOOR) capacity chips — real table/seat/waitlist counters in the
 * archetype's own words, replacing the archetype-agnostic Workforce/AI/Open-demand
 * chips for a restaurant so the Workspace headline reads as capacity, not staffing.
 */
export function restaurantCapacityChips(snap: RestaurantCapacitySnapshot): CapacityChipData[] {
  const seated = snap.counts.occupied + snap.counts["turning-soon"];
  const chips: CapacityChipData[] = [
    { key: "tables-open", label: "Tables open", value: snap.counts.available, intent: snap.counts.available > 0 ? "success" : "warning", live: true },
    { key: "tables-seated", label: "Seated", value: seated, intent: "info", live: true },
  ];
  if (snap.counts["turning-soon"] > 0) {
    chips.push({ key: "turning", label: "Turning soon", value: snap.counts["turning-soon"], intent: "warning", live: true });
  }
  chips.push(
    { key: "waiting", label: "Parties waiting", value: snap.waitlistParties, intent: snap.waitlistParties > 0 ? "warning" : "success", live: true },
    { key: "reservations", label: "Reservations ahead", value: snap.upcomingReservations, intent: "accent", live: true },
  );
  return chips;
}

/** The service-period readiness answer as a top-priority quest — so a
 *  restaurant's "NEEDS YOU" reflects real reservation/table demand ahead of the
 *  generic finance/tax quests. Null when nothing needs the owner. */
export function readinessQuest(snap: RestaurantCapacitySnapshot): QuestData | null {
  if (!snap.nextAction) return null;
  return {
    key: "service-readiness",
    title: readinessHeadline(snap),
    detail: snap.nextAction.label,
    intent: snap.readiness === "not-ready" ? "danger" : "warning",
    cta: snap.nextAction.label,
  };
}

/** The longest a pending item has waited — the queue's headline flow metric. */
export function longestWaitMs(bookings: BookingRow[], now: Date): number {
  // Only genuine walk-in waits count — scheduled reservations (upcoming or
  // overdue) are not "waiting", so an all-reservations business (a restaurant)
  // reports no headline wait instead of a spurious multi-day figure.
  const waiting = bookings.filter(
    (b) => (b.status.toLowerCase() === "pending" || b.provider == null) && isWalkInWait(b),
  );
  let max = 0;
  for (const b of waiting) {
    if (b.createdAt) max = Math.max(max, now.getTime() - b.createdAt.getTime());
  }
  return max;
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

function resolveTemplateDef(archetypeId: string): ArchetypeDefinition | undefined {
  return ALL_ARCHETYPES.find((a) => a.archetypeId === archetypeId);
}

/** Operating windows from the archetype template — the service-period source for
 *  the workspace readiness answer (the confirmed-hours refinement lives in the
 *  Tables page loader, which also reads BusinessProfile). */
function floorWindows(def: ArchetypeDefinition): OperatingWindow[] {
  return (def.schedulingDefaults?.defaultOperatingHours ?? []).map((h) => ({
    day: h.day,
    start: h.start,
    end: h.end,
  }));
}

/**
 * Load the live twin snapshot for the deployment's single org. Returns `null`
 * when no org is configured (or its archetype has no template definition) — the
 * caller falls back to `buildDemoTwinSnapshot`. Mirrors the `platform-loader`
 * idiom: injected client, `Promise.all` fan-out, fail-soft reads.
 */
export async function loadLivingBusinessSnapshot(opts?: {
  db?: LivingBusinessClient;
  now?: Date;
}): Promise<LiveTwinSnapshot | null> {
  const db = opts?.db ?? ((await import("@dpf/db")).prisma as unknown as LivingBusinessClient);
  const now = opts?.now ?? new Date();
  const in7 = new Date(now.getTime() + 7 * 86_400_000);

  const config = (await db.storefrontConfig.findFirst({
    select: { archetype: { select: { archetypeId: true, name: true } } },
  })) as { archetype: { archetypeId: string; name: string } | null } | null;

  const archetypeId = config?.archetype?.archetypeId;
  if (!archetypeId) return null;
  const def = resolveTemplateDef(archetypeId);
  if (!def) return null;

  const profile: TwinProfile = deriveTwinProfile(def);

  const in90 = new Date(now.getTime() - 90 * 86_400_000);
  const [roster, bills, taxPeriods, obligations, bookings, providers, paidInvoices, orgLocale] = await Promise.all([
    loadWorkforceRoster({ db }).catch(() => ({ members: [], summary: { total: 0, humans: 0, agents: 0, agentsWithUnmetNeeds: 0 } })),
    db.bill
      .findMany({
        where: { status: { notIn: ["paid", "void"] }, dueDate: { gte: now, lte: in7 } },
        select: { amountDue: true, dueDate: true, status: true, currency: true },
      })
      .catch(() => []) as Promise<BillRow[]>,
    db.taxObligationPeriod
      .findMany({
        where: { filedAt: null },
        orderBy: { dueDate: "asc" },
        take: 1,
        select: { dueDate: true, status: true, filedAt: true },
      })
      .catch(() => []) as Promise<TaxPeriodRow[]>,
    db.obligation
      .findMany({ where: { status: "active" }, select: { status: true, reviewDate: true } })
      .catch(() => []) as Promise<ObligationRow[]>,
    db.storefrontBooking
      .findMany({
        where: { status: { notIn: ["completed", "cancelled"] } },
        orderBy: { scheduledAt: "asc" },
        take: 24,
        select: {
          id: true,
          providerId: true,
          scheduledAt: true,
          createdAt: true,
          status: true,
          provider: { select: { name: true } },
        },
      })
      .catch(() => []) as Promise<BookingRow[]>,
    db.serviceProvider
      .findMany({ where: { isActive: true }, take: 12, select: { id: true, name: true, isActive: true } })
      .catch(() => []) as Promise<ProviderRow[]>,
    (db.invoice?.findMany
      ? db.invoice
          .findMany({
            where: { paidAt: { not: null, gte: in90 } },
            select: { totalAmount: true, currency: true },
          })
          .catch(() => [])
      : Promise.resolve([])) as Promise<InvoiceRow[]>,
    resolveOrgLocale(db),
  ]);

  const members = roster.members;
  const billsDueAmount = bills.reduce((sum, b) => sum + toNum(b.amountDue), 0);
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

  // Render the resource units under the zone that actually holds them
  // (`capacityZoneKey`) — a restaurant's tables belong in the dining room, not
  // "Kitchen / the pass"; a shop's work orders on the bays, not at intake. Its
  // label resolves from the profile at render time (TwinView).
  const zones: TwinZoneSnapshot[] = [
    {
      key: profile.capacityZoneKey ?? profile.zones[0]?.key ?? "board",
      units: resourceUnits(providers, members),
    },
  ];

  // FLOOR (Restaurant) capacity: derive one snapshot from the SAME providers +
  // bookings this projection already loaded, so the Workspace capacity chips,
  // reservations queue, and readiness answer reconcile with the Storefront
  // Tables & Capacity page and inbox (BI-7C95A586 / BI-348766E5). The workspace
  // reads only active providers, so `blocked` is not a workspace headline — the
  // Tables page owns the authoritative blocked count.
  const floorSnapshot: RestaurantCapacitySnapshot | null =
    profile.template === "FLOOR"
      ? deriveRestaurantCapacity({
          resources: providers.map(
            (p): CapacityResourceInput => ({ id: p.id, name: p.name, isActive: p.isActive }),
          ),
          bookings: bookings.map(
            (b): CapacityBookingInput => ({
              id: b.id,
              providerId: b.providerId ?? null,
              scheduledAt: b.scheduledAt,
              durationMinutes: null, // default turn (90m) applied by the projection
              status: b.status,
            }),
          ),
          now,
          nextPeriod: resolveServicePeriod(floorWindows(def), now),
        })
      : null;

  // NB: the Reservations-queue reconciliation (fixing "RESERVATIONS 0" while
  // booking history exists) is owned by BI-348766E5 (PR #3403), which edits this
  // same queue construction. This PR (BI-7C95A586) deliberately leaves it alone
  // to avoid duplicating that work — it owns the capacity chips + readiness only.
  const queueItems = bookingsToQueueItems(bookings, now);
  const queues: TwinQueueSnapshot[] = profile.queues.map((qs, i) => ({
    key: qs.key,
    items: i === 0 ? queueItems : [],
    emptyLabel: i === 0 ? "No demand waiting" : "Clear",
  }));

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

  // Customer outcomes (workstream D): revenue realized in the last 90 days + the
  // count of settled+paid work — the proof the business is producing.
  const paidRevenue = paidInvoices.reduce((sum, inv) => sum + toNum(inv.totalAmount), 0);
  const outcomes: TwinOutcome[] = [
    {
      key: "revenue",
      label: "Revenue in",
      value: formatMoney(paidRevenue, orgCurrency, orgLocaleStr),
      intent: "success",
      hint: "Paid · 90 days",
    },
    {
      key: "delivered",
      label: "Delivered",
      value: `${paidInvoices.length} job${paidInvoices.length === 1 ? "" : "s"}`,
      intent: "info",
      hint: "Settled & paid",
    },
  ];

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

  return {
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
    outcomes,
    zones,
    workItems: bookingsToWorkItems(bookings, profile.workItemNoun.singular),
    queues,
    cog,
    presence: rosterToPresence(members),
    feed: bookingsToFeed(bookings, profile.workItemNoun.singular),
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
}
