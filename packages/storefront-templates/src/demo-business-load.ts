import type {
  DemoBusiness,
  DemoBill,
  DemoDemandItem,
} from "./demo-business";

/**
 * Archetype Demo Factory — the **pure load plan** (EP-ARCHETYPE-DEMO A·P1).
 *
 * `planDemoLoad` maps a generated {@link DemoBusiness} onto the exact rows the
 * live `loadLivingBusinessSnapshot` projection reads (ServiceProvider,
 * StorefrontBooking, Bill/Supplier, EmployeeProfile) — deterministically and
 * DB-free, so the risky part (field mapping, reversible `demo-` tagging, the
 * load-over-real-data guardrail) is unit-testable without a database. The thin
 * `apps/web/lib/demo/load-demo-business.ts` executor resolves the storefront/item
 * ids, stamps absolute dates, and runs the prisma upserts from this plan.
 *
 * Provenance/teardown (spec §4, §9.1): most target models have **no** `source`
 * column, so every demo row carries a stable {@link DEMO_REF_PREFIX} on its
 * `@unique` business ref. Teardown is a `deleteMany({ ref: { startsWith:
 * DEMO_REF_PREFIX } })` — fully reversible, single-org-safe.
 *
 * PURE + DB-free + deterministic (no `Math.random`/`Date`): the plan speaks in
 * *relative* offsets (minutes/days); the executor turns them into timestamps.
 */

export const DEMO_REF_PREFIX = "demo-";

export interface DemoProviderUpsert {
  /** `demo-<archetypeId>-<resourceKey>` — the ServiceProvider.providerId. */
  providerId: string;
  name: string;
  isActive: boolean;
  /** The demo employee this provider is (when the resource is a person). */
  employeeRef?: string;
}

export interface DemoSupplierUpsert {
  supplierId: string;
  name: string;
}

export interface DemoBillUpsert {
  billRef: string;
  supplierId: string;
  subtotal: number;
  totalAmount: number;
  amountDue: number;
  currency: string;
  status: string;
  /** Days ago the bill was issued (executor: issueDate = now − issuedDaysAgo). */
  issuedDaysAgo: number;
  /** Days ahead the bill is due (executor: dueDate = now + dueInDays). */
  dueInDays: number;
}

export interface DemoBookingUpsert {
  bookingRef: string;
  itemId: string;
  providerId?: string;
  customerName: string;
  customerEmail: string;
  /** Minutes from now the booking is scheduled (negative = past). */
  scheduledInMinutes: number;
  /** Minutes ago the booking was created — drives the twin's queue wait-time. */
  createdMinutesAgo: number;
  durationMinutes: number;
  status: "pending" | "confirmed" | "completed";
}

export interface DemoEmployeeUpsert {
  employeeRef: string;
  firstName: string;
  lastName: string;
  displayName: string;
  role: string;
}

export interface DemoLoadPlan {
  archetypeId: string;
  currency: string;
  providers: DemoProviderUpsert[];
  suppliers: DemoSupplierUpsert[];
  bills: DemoBillUpsert[];
  bookings: DemoBookingUpsert[];
  employees: DemoEmployeeUpsert[];
}

export interface PlanDemoLoadInput {
  /** The deployment org's storefront id (resolved by the executor). */
  storefrontId: string;
  /** Real StorefrontItem ids to attach demo bookings to (bookings round-robin over them). */
  itemIds: string[];
  /** Default booking length when the archetype has none. */
  defaultDurationMinutes?: number;
}

function ref(archetypeId: string, kind: string, key: string): string {
  return `${DEMO_REF_PREFIX}${archetypeId}-${kind}-${key}`;
}

function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function bookingStatusFor(item: DemoDemandItem): DemoBookingUpsert["status"] {
  if (item.queueKey) return "pending"; // waiting in a queue
  if (item.stageKey === "settle") return "completed"; // recently settled
  return "confirmed"; // in-flight / being delivered
}

function scheduledMinutesFor(item: DemoDemandItem, index: number): number {
  const status = bookingStatusFor(item);
  if (status === "completed") return -(60 + index * 30); // in the recent past
  if (status === "pending") return 30 + index * 15; // upcoming
  return 5 + index * 5; // in-flight, imminent
}

/**
 * Map a demo business onto its load plan. Pure and total. `input.itemIds` must
 * be non-empty (bookings need a real item to attach to); throws otherwise so the
 * executor fails loudly rather than writing orphaned rows.
 */
export function planDemoLoad(demo: DemoBusiness, input: PlanDemoLoadInput): DemoLoadPlan {
  if (input.itemIds.length === 0) {
    throw new Error(`planDemoLoad: no StorefrontItem ids for ${demo.archetypeId}`);
  }
  const { archetypeId } = demo;
  const duration = input.defaultDurationMinutes ?? 30;

  // Employees — the human workforce (AI coworkers rely on existing seeded Agents).
  const employees: DemoEmployeeUpsert[] = demo.workforce
    .filter((w) => w.kind === "human")
    .map((w) => {
      const { firstName, lastName } = splitName(w.name);
      return {
        employeeRef: ref(archetypeId, "emp", w.key),
        firstName,
        lastName,
        displayName: w.name,
        role: w.role,
      };
    });
  const employeeRefByWorker = new Map(
    demo.workforce.filter((w) => w.kind === "human").map((w) => [w.key, ref(archetypeId, "emp", w.key)]),
  );

  // Providers — the countable resources the twin arranges in zones.
  const providers: DemoProviderUpsert[] = demo.resources.map((r) => ({
    providerId: ref(archetypeId, "prov", r.key),
    name: r.label,
    isActive: true,
    ...(r.workerKey && employeeRefByWorker.has(r.workerKey)
      ? { employeeRef: employeeRefByWorker.get(r.workerKey) }
      : {}),
  }));
  const providerRefByResource = new Map(demo.resources.map((r) => [r.key, ref(archetypeId, "prov", r.key)]));

  // Suppliers — deduped from the bills.
  const supplierRefByName = new Map<string, string>();
  const suppliers: DemoSupplierUpsert[] = [];
  for (const bill of demo.finance.bills) {
    if (!supplierRefByName.has(bill.supplierName)) {
      const supplierId = ref(
        archetypeId,
        "sup",
        bill.supplierName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
      );
      supplierRefByName.set(bill.supplierName, supplierId);
      suppliers.push({ supplierId, name: bill.supplierName });
    }
  }

  const bills: DemoBillUpsert[] = demo.finance.bills.map((bill: DemoBill) => ({
    billRef: ref(archetypeId, "bill", bill.key),
    supplierId: supplierRefByName.get(bill.supplierName)!,
    subtotal: bill.amountDue,
    totalAmount: bill.amountDue,
    amountDue: bill.amountDue,
    currency: demo.currency,
    status: bill.status === "overdue" ? "approved" : bill.status,
    issuedDaysAgo: 7,
    dueInDays: bill.dueInDays,
  }));

  // Customer lookup for booking contact fields.
  const customerByKey = new Map(demo.customers.map((c) => [c.key, c]));

  // Demand → bookings (the twin's demand + queue spine).
  const bookings: DemoBookingUpsert[] = demo.demand.map((item, i) => {
    const customer = customerByKey.get(item.customerKey) ?? demo.customers[0];
    const providerId = item.assignedResourceKey
      ? providerRefByResource.get(item.assignedResourceKey)
      : undefined;
    return {
      bookingRef: ref(archetypeId, "bk", String(i)),
      itemId: input.itemIds[i % input.itemIds.length],
      ...(providerId ? { providerId } : {}),
      customerName: customer.name,
      customerEmail: customer.email,
      scheduledInMinutes: scheduledMinutesFor(item, i),
      createdMinutesAgo: item.waitingMinutes,
      durationMinutes: duration,
      status: bookingStatusFor(item),
    };
  });

  return {
    archetypeId,
    currency: demo.currency,
    providers,
    suppliers,
    bills,
    bookings,
    employees,
  };
}

/**
 * The `@unique`-ref prefixes the teardown deletes by, per model. The executor
 * runs `deleteMany` in this order (children before parents) so FK constraints
 * hold: bookings → providers, bills → suppliers, providers → employees.
 */
export interface DemoTeardownSpec {
  bookingRefPrefix: string;
  providerRefPrefix: string;
  billRefPrefix: string;
  supplierRefPrefix: string;
  employeeRefPrefix: string;
}

export function demoTeardownSpec(archetypeId?: string): DemoTeardownSpec {
  const base = archetypeId ? `${DEMO_REF_PREFIX}${archetypeId}-` : DEMO_REF_PREFIX;
  return {
    bookingRefPrefix: archetypeId ? `${base}bk-` : DEMO_REF_PREFIX,
    providerRefPrefix: archetypeId ? `${base}prov-` : DEMO_REF_PREFIX,
    billRefPrefix: archetypeId ? `${base}bill-` : DEMO_REF_PREFIX,
    supplierRefPrefix: archetypeId ? `${base}sup-` : DEMO_REF_PREFIX,
    employeeRefPrefix: archetypeId ? `${base}emp-` : DEMO_REF_PREFIX,
  };
}

/**
 * The load-over-real-data guardrail (spec §4). Given counts of rows whose refs
 * do NOT carry the demo prefix, decide whether loading a demo is safe. Real
 * bookings or invoices mean a real operating business — refuse.
 */
export function isSafeToLoadDemo(nonDemoCounts: { bookings: number; invoices: number }): boolean {
  return nonDemoCounts.bookings === 0 && nonDemoCounts.invoices === 0;
}
