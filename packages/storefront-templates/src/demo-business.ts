import type { ArchetypeDefinition, ItemTemplate } from "./types";
import {
  deriveOperationalValueStream,
  type OperationalValueStreamStageKey,
} from "./operational-value-stream";
import { deriveTwinProfile, type TwinProfile, type TwinTemplate } from "./twin-profile";
import { deriveTwinValueStreamBinding } from "./twin-value-stream";
import { resolveDemoFlavor } from "./demo-flavor";

/**
 * Archetype Demo Factory — `deriveDemoBusiness` (EP-ARCHETYPE-DEMO, workstream A
 * of EP-LIVING-BUSINESS-EXCELLENCE).
 *
 * The fifth member of DPF's derive-with-override family
 * (`deriveOperationalValueStream` · `deriveTwinProfile` ·
 * `deriveFieldDispatchProfile` · `deriveMediaProfile` · **`deriveDemoBusiness`**).
 * Produces a realistic, persona'd demo business — workforce, customers, demand
 * (across the value-stream stages *and* the twin's queues), and money in-flight —
 * for ANY archetype, so we can see/test/iterate every one of the 94 without a
 * per-archetype build.
 *
 * Design: docs/superpowers/specs/2026-07-15-archetype-demo-factory-design.md §2–5
 * Plan:   docs/superpowers/plans/2026-07-15-archetype-demo-factory-execution.md P1
 *
 * PURE + DB-free + deterministic (mirrors twin-profile.ts / operational-value-
 * stream.ts / components/twin/demo-snapshot.ts — no `Math.random`/`Date` in the
 * core), so demos are reproducible, snapshot-testable, and diffable. Coverage is
 * 94/94 from a single generator; a thin per-archetype {@link DemoFlavor} raises
 * fidelity without touching the derivation. Anything time/DB-stamped (`seededAt`,
 * concrete calendar dates, DB ids) is applied by the load path, not here.
 */

// ── Output shape (spec §3) ────────────────────────────────────────────────────

export type DemoWorkerKind = "human" | "ai";

export interface DemoWorker {
  /** Stable key; the load path derives a `demo-`-prefixed EmployeeProfile / Agent ref from it. */
  key: string;
  name: string;
  role: string;
  kind: DemoWorkerKind;
  /** Which twin zone this person primarily works. */
  zoneKey: string;
}

export interface DemoCustomer {
  key: string;
  name: string;
  email: string;
}

/** A countable resource unit arranged in a twin zone (table/bay/chair/room/account/provider). */
export interface DemoResource {
  /** Stable key; the load path derives a `demo-`-prefixed ServiceProvider ref from it. */
  key: string;
  label: string;
  zoneKey: string;
  /** Set when the resource is a person (a provider), linking to a {@link DemoWorker}. */
  workerKey?: string;
}

/** One unit of demand flowing through the twin — mapped to BOTH a value-stream stage
 *  (the Epic C grounding hook) and, when still waiting, a twin queue. */
export interface DemoDemandItem {
  key: string;
  label: string;
  /** Where in the operational value stream this work sits. */
  stageKey: OperationalValueStreamStageKey;
  /** The twin queue it is waiting in; undefined once assigned / in-flight. */
  queueKey?: string;
  /** Queue age in minutes → the twin's wait-time. 0 once assigned. */
  waitingMinutes: number;
  /** The resource handling it; undefined while queued/unassigned. */
  assignedResourceKey?: string;
  /** The customer this work is for. */
  customerKey: string;
  /** Value of the work item in the business currency (major units). */
  amount: number;
}

export interface DemoBill {
  key: string;
  supplierName: string;
  amountDue: number;
  dueInDays: number;
  status: "draft" | "approved" | "overdue";
}

export interface DemoInvoice {
  key: string;
  customerKey: string;
  amount: number;
  /** Paid invoices are revenue accruing — the Epic D customer-outcome signal. */
  paid: boolean;
  issuedDaysAgo: number;
}

export interface DemoTaxPeriod {
  key: string;
  label: string;
  dueInDays: number;
  filed: boolean;
}

export interface DemoObligation {
  key: string;
  title: string;
  reviewInDays: number;
  status: "active";
}

export interface DemoFinance {
  currency: string;
  bills: DemoBill[];
  invoices: DemoInvoice[];
  taxPeriod: DemoTaxPeriod | null;
  obligations: DemoObligation[];
}

export interface DemoBusiness {
  archetypeId: string;
  archetypeName: string;
  companyName: string;
  currency: string;
  timezone: string;
  /** The twin template this archetype renders as (from `deriveTwinProfile`). */
  template: TwinTemplate;
  workforce: DemoWorker[];
  resources: DemoResource[];
  customers: DemoCustomer[];
  demand: DemoDemandItem[];
  finance: DemoFinance;
  /** The AI cog's proposed allocation — "a real move" the twin surfaces. */
  cogProposal: string;
  /** What a well-run one is aiming at — flavored by the injected playbook/profile when present. */
  narrative: { primaryGoal: string; keyMetrics: string[]; whoWeServe: string; notes?: string };
}

// ── Thin flavor layer + injected enrichment (spec §2.2) ───────────────────────

/** The only authored part. Absent, the generator falls back to derived defaults
 *  that are always valid (94/94 coverage; fidelity incremental). Shared with the
 *  Excellence Corpus (workstream B). */
export interface DemoFlavor {
  companyName?: string;
  currency?: string;
  timezone?: string;
  staff?: Array<{ name: string; role?: string }>;
  customers?: string[];
  signatureOfferings?: string[];
  notes?: string;
}

export interface DeriveDemoBusinessOptions {
  /** Deterministic seed; defaults to the archetypeId. */
  seed?: string;
  flavor?: DemoFlavor;
  /** Optional playbook signal (the app injects `getPlaybook(category, ctaType)`);
   *  enrichment only — the core is valid without it. */
  playbook?: { primaryGoal?: string; keyMetrics?: string[] };
  /** Optional business-profile signal (the app injects `resolveBusinessProfile(...)`). */
  businessProfile?: { whoWeServe?: string };
}

// ── Deterministic draws (no Math.random/Date; order-independent) ──────────────

function hashString(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function draw(seed: string, salt: string): number {
  return hashString(`${seed}::${salt}`);
}

function pickFrom<T>(arr: readonly T[], seed: string, salt: string): T {
  return arr[draw(seed, salt) % arr.length];
}

function intIn(lo: number, hi: number, seed: string, salt: string): number {
  if (hi <= lo) return lo;
  return lo + (draw(seed, salt) % (hi - lo + 1));
}

function titleCase(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

// ── Name / role pools ─────────────────────────────────────────────────────────

const PLACES = [
  "Riverside", "Oakwood", "Meadowbrook", "Fairview", "Kingsley", "Ashford",
  "Elmgrove", "Harborview", "Westbourne", "Cedar Park", "Brookfield", "Northgate",
] as const;

const FIRST_NAMES = [
  "Amara", "Ben", "Chloe", "Devan", "Elif", "Farid", "Grace", "Hugo", "Iris",
  "Jaya", "Kofi", "Lena", "Marco", "Nadia", "Omar", "Priya", "Quinn", "Rosa",
  "Sam", "Tariq", "Uma", "Vik", "Wren", "Yara", "Zane",
] as const;

const LAST_NAMES = [
  "Ali", "Bloom", "Costa", "Doyle", "Egan", "Frost", "Gill", "Haynes", "Ibarra",
  "Jensen", "Khan", "Lowe", "Mensah", "Nawaz", "Owens", "Patel", "Reyes",
  "Silva", "Turner", "Ueno", "Vance", "Wolfe", "Yusuf",
] as const;

const SUPPLIERS = [
  "Northwind Supplies", "Apex Utilities", "Clearline Telecom", "Sterling Insurance",
  "Greenfield Logistics", "Pinnacle Software", "Harbor Facilities", "Vantage Payroll",
] as const;

/** Per-template human roster patterns — the people who work the twin (distinct
 *  from the resource *units*, which may be tables/bays/chairs rather than people). */
const TEMPLATE_ROLES: Record<TwinTemplate, string[]> = {
  FLOOR: ["Head Chef", "Server", "Host"],
  TERRITORY: ["Lead Technician", "Field Technician", "Dispatcher"],
  YARD: ["Yard Supervisor", "Rental Agent", "Maintenance Hand"],
  BAYS: ["Service Advisor", "Master Technician", "Parts Clerk"],
  BOOK: ["Lead Provider", "Provider", "Front-Desk Coordinator"],
  ROOMS: ["Duty Manager", "Care Assistant", "Front Desk"],
  STORE: ["Store Manager", "Sales Associate", "Stock Lead"],
  VENUE: ["Event Manager", "Coordinator", "Box Office"],
  COUNTER: ["Case Officer", "Senior Reviewer", "Intake Clerk"],
  DOCK: ["Warehouse Manager", "Inventory Controller", "Picker"],
  TENANTS: ["Account Manager", "Success Lead", "Onboarding Specialist"],
  PIPELINE: ["Partner", "Senior Associate", "Associate"],
  PROGRAMS: ["Program Director", "Program Manager", "Volunteer Coordinator"],
};

/** Personified resource nouns — when the twin's resource IS a person (a provider),
 *  the resource links to a worker; otherwise it is an object (table/bay/room). */
const PERSON_RESOURCE_NOUNS = new Set([
  "provider", "professional", "reviewer", "technician", "account", "program",
]);

function humanizeCog(kind: string): string {
  return kind.split("-").map(titleCase).join(" ");
}


/** A plausible per-ticket value from the archetype's own item prices, else a
 *  category-shaped default. */
function ticketValue(archetype: ArchetypeDefinition, seed: string): number {
  const priced = archetype.itemTemplates
    .map((t: ItemTemplate) => t.priceAmount)
    .filter((n): n is number => typeof n === "number" && n > 0)
    .sort((a, b) => a - b);
  if (priced.length > 0) {
    const median = priced[Math.floor(priced.length / 2)];
    return Math.max(15, Math.round(median));
  }
  // No seeded prices (quote/booking/donation items) — shape by CTA.
  switch (archetype.ctaType) {
    case "donation":
      return intIn(20, 150, seed, "ticket-donation");
    case "purchase":
      return intIn(15, 120, seed, "ticket-purchase");
    case "rental":
      return intIn(80, 600, seed, "ticket-rental");
    default:
      return intIn(60, 480, seed, "ticket-service");
  }
}

const REGULATED_CATEGORIES = new Set([
  "healthcare-wellness", "banking-financial-services", "public-sector",
]);

// ── The generator ─────────────────────────────────────────────────────────────

/**
 * Derive a realistic demo business for an archetype. Pure, total (always returns
 * a non-degenerate business — see {@link evaluateDemoDelight}), deterministic in
 * `seed`, and flavor/enrichment-respecting.
 */
export function deriveDemoBusiness(
  archetype: ArchetypeDefinition,
  options: DeriveDemoBusinessOptions = {},
): DemoBusiness {
  const seed = options.seed ?? archetype.archetypeId;
  // Default to the authored flavor registry (raises fidelity for curated
  // archetypes); an explicit options.flavor still wins.
  const flavor = options.flavor ?? resolveDemoFlavor(archetype.archetypeId, archetype.category);
  const profile = deriveTwinProfile(archetype);
  const ovs = deriveOperationalValueStream(archetype);
  // Grounding (workstream C): the single source of truth for which value-stream
  // stage each twin queue's demand sits in.
  const binding = deriveTwinValueStreamBinding(archetype);

  const currency = flavor?.currency ?? "GBP";
  const timezone = flavor?.timezone ?? "Europe/London";
  const companyName = flavor?.companyName ?? `${pickFrom(PLACES, seed, "place")} ${archetype.name}`;

  // ── Workforce: people who work the twin (≥1 human + ≥1 AI coworker) ──────────
  const zones = profile.zones;
  const rolePattern = TEMPLATE_ROLES[profile.template];
  const humanCount = Math.min(8, Math.max(zones.length, 3));
  const workforce: DemoWorker[] = [];

  for (let i = 0; i < humanCount; i += 1) {
    const zoneKey = zones[i % zones.length].key;
    const flavorStaff = flavor?.staff?.[i];
    const name =
      flavorStaff?.name ??
      `${pickFrom(FIRST_NAMES, seed, `wf-first-${i}`)} ${pickFrom(LAST_NAMES, seed, `wf-last-${i}`)}`;
    const role = flavorStaff?.role ?? rolePattern[i % rolePattern.length];
    workforce.push({ key: `worker-${i}`, name, role, kind: "human", zoneKey });
  }
  // The AI coworker that inhabits the twin — role from the cog it assists.
  workforce.push({
    key: "ai-cog",
    name: `AI ${humanizeCog(profile.cog.kind)}`,
    role: `AI ${profile.resourceNoun.singular} coordinator`,
    kind: "ai",
    zoneKey: zones[0].key,
  });

  // ── Resources: the countable units, ≥1 per zone (satisfies the zone oracle) ──
  const resources: DemoResource[] = [];
  const isPersonResource = PERSON_RESOURCE_NOUNS.has(profile.resourceNoun.singular.toLowerCase());
  const humans = workforce.filter((w) => w.kind === "human");
  let resIndex = 0;
  for (const zone of zones) {
    const perZone = intIn(2, 4, seed, `res-count-${zone.key}`);
    for (let i = 0; i < perZone; i += 1) {
      const label = `${titleCase(profile.resourceNoun.singular)} ${resIndex + 1}`;
      const worker = isPersonResource
        ? humans.find((w) => w.zoneKey === zone.key) ?? humans[resIndex % humans.length]
        : undefined;
      resources.push({
        key: `res-${resIndex}`,
        label,
        zoneKey: zone.key,
        ...(worker ? { workerKey: worker.key } : {}),
      });
      resIndex += 1;
    }
  }

  // ── Customers ───────────────────────────────────────────────────────────────
  const customerCount = intIn(6, 10, seed, "cust-count");
  const customers: DemoCustomer[] = [];
  for (let i = 0; i < customerCount; i += 1) {
    const name =
      flavor?.customers?.[i] ??
      `${pickFrom(FIRST_NAMES, seed, `cust-first-${i}`)} ${pickFrom(LAST_NAMES, seed, `cust-last-${i}`)}`;
    customers.push({ key: `cust-${i}`, name, email: `${slug(name)}-${i}@example.com` });
  }

  const value = ticketValue(archetype, seed);
  const workNoun = profile.workItemNoun.singular;

  // ── Demand: queued items per twin queue + in-flight + settled ───────────────
  const demand: DemoDemandItem[] = [];
  let demandIndex = 0;
  const nextCustomer = (salt: string) => customers[draw(seed, salt) % customers.length].key;

  profile.queues.forEach((queue, qi) => {
    const queued = intIn(2, 4, seed, `q-count-${queue.key}`);
    const baseWait = 5 + qi * 3;
    for (let i = 0; i < queued; i += 1) {
      demand.push({
        key: `dm-${demandIndex}`,
        label: `${titleCase(workNoun)} #${1000 + demandIndex}`,
        stageKey: binding.queueToStage[queue.key],
        queueKey: queue.key,
        waitingMinutes: baseWait + i * intIn(4, 12, seed, `q-step-${queue.key}-${i}`),
        customerKey: nextCustomer(`q-cust-${queue.key}-${i}`),
        amount: value + intIn(0, Math.max(1, Math.round(value * 0.4)), seed, `q-amt-${demandIndex}`),
      });
      demandIndex += 1;
    }
  });

  // In-flight work being delivered right now (assigned to resources).
  const inFlight = intIn(3, 6, seed, "inflight-count");
  for (let i = 0; i < inFlight; i += 1) {
    const resource = resources[draw(seed, `if-res-${i}`) % resources.length];
    demand.push({
      key: `dm-${demandIndex}`,
      label: `${titleCase(workNoun)} #${1000 + demandIndex}`,
      stageKey: binding.stages.some((stage) => stage.stageKey === "deliver")
        ? "deliver"
        : binding.zoneToStage[resource.zoneKey] ?? binding.primaryStageKey,
      waitingMinutes: 0,
      assignedResourceKey: resource.key,
      customerKey: nextCustomer(`if-cust-${i}`),
      amount: value + intIn(0, Math.max(1, Math.round(value * 0.4)), seed, `if-amt-${i}`),
    });
    demandIndex += 1;
  }

  // Recently settled work — feeds paid invoices (the outcome signal).
  const settled = intIn(2, 4, seed, "settled-count");
  const finalLoadBearingStage = [...binding.stages].reverse().find((stage) => stage.loadBearing);
  const settledStageKey = binding.stages.some((stage) => stage.stageKey === "settle")
    ? "settle"
    : finalLoadBearingStage?.stageKey
      ?? binding.stages[binding.stages.length - 1]?.stageKey
      ?? binding.primaryStageKey;
  const settledKeys: Array<{ key: string; amount: number; customerKey: string }> = [];
  for (let i = 0; i < settled; i += 1) {
    const customerKey = nextCustomer(`st-cust-${i}`);
    const amount = value + intIn(0, Math.max(1, Math.round(value * 0.6)), seed, `st-amt-${i}`);
    demand.push({
      key: `dm-${demandIndex}`,
      label: `${titleCase(workNoun)} #${1000 + demandIndex}`,
      stageKey: settledStageKey,
      waitingMinutes: 0,
      assignedResourceKey: resources[draw(seed, `st-res-${i}`) % resources.length].key,
      customerKey,
      amount,
    });
    settledKeys.push({ key: `dm-${demandIndex}`, amount, customerKey });
    demandIndex += 1;
  }

  // ── Finance: money in-flight + revenue accruing ─────────────────────────────
  const billCount = intIn(2, 4, seed, "bill-count");
  const billStatuses: Array<DemoBill["status"]> = ["draft", "approved", "overdue"];
  const bills: DemoBill[] = [];
  for (let i = 0; i < billCount; i += 1) {
    bills.push({
      key: `bill-${i}`,
      supplierName: pickFrom(SUPPLIERS, seed, `supplier-${i}`),
      amountDue: intIn(80, 1400, seed, `bill-amt-${i}`),
      dueInDays: intIn(1, 14, seed, `bill-due-${i}`),
      status: billStatuses[draw(seed, `bill-status-${i}`) % billStatuses.length],
    });
  }

  // Every settled item becomes an invoice; at least one is paid (revenue accruing).
  const invoices: DemoInvoice[] = settledKeys.map((s, i) => ({
    key: `inv-${i}`,
    customerKey: s.customerKey,
    amount: s.amount,
    paid: i < Math.max(1, Math.floor(settledKeys.length / 2)),
    issuedDaysAgo: intIn(1, 30, seed, `inv-age-${i}`),
  }));
  // Guarantee at least one paid invoice even if there were no settled items.
  if (invoices.length === 0) {
    invoices.push({
      key: "inv-0",
      customerKey: customers[0].key,
      amount: value,
      paid: true,
      issuedDaysAgo: intIn(1, 20, seed, "inv-age-fallback"),
    });
  }

  const taxPeriod: DemoTaxPeriod = {
    key: "tax-0",
    label: "VAT quarter",
    dueInDays: intIn(15, 45, seed, "tax-due"),
    filed: false,
  };

  const obligations: DemoObligation[] = [];
  if (REGULATED_CATEGORIES.has(archetype.category) || ovs.trustGates.length > 0) {
    const n = intIn(1, 2, seed, "obl-count");
    for (let i = 0; i < n; i += 1) {
      const gate = ovs.trustGates[i] ?? "records-retention";
      obligations.push({
        key: `obl-${i}`,
        title: `${titleCase(gate.replace(/-/g, " "))} review`,
        reviewInDays: intIn(5, 60, seed, `obl-due-${i}`),
        status: "active",
      });
    }
  }

  const finance: DemoFinance = { currency, bills, invoices, taxPeriod, obligations };

  const cogProposal = `Allocate the next ${workNoun} to the best ${profile.resourceNoun.singular} by ${profile.cog.signals[0]}`;

  const narrative = {
    primaryGoal:
      options.playbook?.primaryGoal ??
      `Keep ${profile.resourceNoun.plural} well-utilised and ${profile.workItemNoun.plural} moving through ${ovs.stages.length} stages`,
    keyMetrics:
      options.playbook?.keyMetrics && options.playbook.keyMetrics.length > 0
        ? options.playbook.keyMetrics
        : profile.capacityChips,
    whoWeServe: options.businessProfile?.whoWeServe ?? "Local customers and repeat clients.",
    ...(flavor?.notes ? { notes: flavor.notes } : {}),
  };

  return {
    archetypeId: archetype.archetypeId,
    archetypeName: archetype.name,
    companyName,
    currency,
    timezone,
    template: profile.template,
    workforce,
    resources,
    customers,
    demand,
    finance,
    cogProposal,
    narrative,
  };
}

// ── The delight oracle (spec §5.3) ────────────────────────────────────────────

export interface DelightVerdict {
  ok: boolean;
  violations: string[];
}

/**
 * Assert a demo business is **non-degenerate and plausible** — the machine-
 * checkable proxy for "would a real owner recognise this?". Reused by the golden
 * snapshot test and, later, the P4 CI quality gate. Pass the twin profile so the
 * zone-coverage check is exact.
 */
export function evaluateDemoDelight(demo: DemoBusiness, profile: TwinProfile): DelightVerdict {
  const violations: string[] = [];

  // Every zone has resources.
  for (const zone of profile.zones) {
    if (!demo.resources.some((r) => r.zoneKey === zone.key)) {
      violations.push(`zone "${zone.key}" has no resources`);
    }
  }

  // Presence has both humans and AI.
  if (!demo.workforce.some((w) => w.kind === "human")) violations.push("no human in the workforce");
  if (!demo.workforce.some((w) => w.kind === "ai")) violations.push("no AI coworker in the workforce");

  // The primary queue has demand with sane wait-times.
  const primaryQueue = profile.queues[0];
  if (primaryQueue) {
    const queued = demo.demand.filter((d) => d.queueKey === primaryQueue.key);
    if (queued.length === 0) {
      violations.push(`primary queue "${primaryQueue.key}" has no demand`);
    } else if (!queued.every((d) => d.waitingMinutes >= 1 && d.waitingMinutes <= 600)) {
      violations.push(`primary queue "${primaryQueue.key}" has an insane wait-time`);
    }
  }

  // The cog has a real proposed move.
  if (!demo.cogProposal || demo.cogProposal.trim().length === 0) {
    violations.push("cog has no proposed move");
  }

  // Finance shows money in-flight …
  const billsTotal = demo.finance.bills.reduce((s, b) => s + b.amountDue, 0);
  if (billsTotal <= 0) violations.push("no money owed (bills)");
  // … and revenue accruing (the Epic D outcome signal).
  if (!demo.finance.invoices.some((inv) => inv.paid)) violations.push("no revenue accruing (paid invoices)");

  // Demand actually spans the value stream (grounding).
  if (demo.demand.length === 0) violations.push("no demand at all");
  if (!demo.customers.length) violations.push("no customers");

  return { ok: violations.length === 0, violations };
}

/** A compact, reviewable per-archetype digest for the golden snapshot (spec §5.2). */
export function summarizeDemoBusiness(demo: DemoBusiness) {
  const primaryQueue = demo.demand.filter((d) => d.queueKey).map((d) => d.queueKey)[0];
  const stageCounts: Partial<Record<OperationalValueStreamStageKey, number>> = {};
  for (const d of demo.demand) stageCounts[d.stageKey] = (stageCounts[d.stageKey] ?? 0) + 1;
  return {
    archetypeId: demo.archetypeId,
    companyName: demo.companyName,
    template: demo.template,
    currency: demo.currency,
    workforce: {
      humans: demo.workforce.filter((w) => w.kind === "human").length,
      ai: demo.workforce.filter((w) => w.kind === "ai").length,
    },
    resources: demo.resources.length,
    customers: demo.customers.length,
    demand: {
      total: demo.demand.length,
      queued: demo.demand.filter((d) => d.queueKey).length,
      inFlight: demo.demand.filter((d) => !d.queueKey && d.waitingMinutes === 0).length,
      byStage: stageCounts,
      primaryQueue,
    },
    finance: {
      bills: demo.finance.bills.length,
      invoices: demo.finance.invoices.length,
      paidInvoices: demo.finance.invoices.filter((i) => i.paid).length,
      hasTaxPeriod: demo.finance.taxPeriod !== null,
      obligations: demo.finance.obligations.length,
    },
    cogProposal: demo.cogProposal,
  };
}
