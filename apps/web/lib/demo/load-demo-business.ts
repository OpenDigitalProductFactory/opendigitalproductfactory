import { prisma } from "@dpf/db";
import {
  ALL_ARCHETYPES,
  deriveDemoBusiness,
  planDemoLoad,
  demoTeardownSpec,
  isSafeToLoadDemo,
  DEMO_REF_PREFIX,
  type DemoFlavor,
  type DemoLoadPlan,
} from "@dpf/storefront-templates";

import { resetStorefrontArchetype } from "@/lib/storefront/archetype-reset";
import { runSetupCompletionSeeds } from "@/lib/onboarding/setup-completion-seeds";
import { getPlaybook } from "@/lib/tak/marketing-playbooks";
import { resolveBusinessProfile } from "@/lib/onboarding/archetype-business-context";
import {
  persistRestaurantDemoFloor,
  removeRestaurantDemoFloor,
  type RestaurantDemoFloorDatabase,
} from "./persist-restaurant-demo-floor";

/**
 * Archetype Demo Factory — the load path (EP-ARCHETYPE-DEMO A·P1).
 *
 * `loadDemoBusiness` stands up a realistic, persona'd business for an archetype
 * on the deployment org by (1) setting the org archetype via the existing reset
 * path, (2) generating a {@link deriveDemoBusiness} + mapping it with the pure
 * {@link planDemoLoad}, (3) upserting the plan into the real tables tagged with a
 * reversible `demo-` ref prefix, and (4) running the setup-completion seeds
 * (incl. WWWD priming). The result renders through the LIVE
 * `loadLivingBusinessSnapshot` projection — same code path, not a fixture.
 *
 * `unloadDemoBusiness` removes every `demo-` row — a clean, single-org-safe
 * teardown. A guardrail refuses to load over an org that has real (non-demo)
 * bookings or invoices (spec §4).
 *
 * Thin by design: all mapping/tagging logic lives in the pure, unit-tested
 * `planDemoLoad`; this module is the IO shell (org resolution, dates, prisma
 * upserts, seeds). `db` is injectable for tests.
 */

type Db = typeof prisma;

const MIN = 60_000;
const DAY = 86_400_000;

export interface LoadDemoBusinessOptions {
  flavor?: DemoFlavor;
  /** Load even if the org already has non-demo data (default false — the guardrail). */
  force?: boolean;
  db?: Db;
  /** Injected clock for deterministic tests; defaults to now. */
  now?: Date;
}

export interface LoadDemoBusinessResult {
  archetypeId: string;
  storefrontId: string;
  seededAt: Date;
  /** False when the (non-fatal) setup-completion priming seeds failed. */
  primed: boolean;
  counts: {
    providers: number;
    bookings: number;
    bills: number;
    suppliers: number;
    employees: number;
  };
}

async function nonDemoDataCounts(db: Db): Promise<{ bookings: number; invoices: number }> {
  const [bookings, invoices] = await Promise.all([
    db.storefrontBooking.count({ where: { NOT: { bookingRef: { startsWith: DEMO_REF_PREFIX } } } }),
    db.invoice.count({ where: { NOT: { invoiceRef: { startsWith: DEMO_REF_PREFIX } } } }),
  ]);
  return { bookings, invoices };
}

export async function loadDemoBusiness(
  archetypeId: string,
  options: LoadDemoBusinessOptions = {},
): Promise<LoadDemoBusinessResult> {
  const db = options.db ?? prisma;
  const now = options.now ?? new Date();

  const archetype = ALL_ARCHETYPES.find((a) => a.archetypeId === archetypeId);
  if (!archetype) throw new Error(`loadDemoBusiness: unknown archetype "${archetypeId}"`);

  const org = await db.organization.findFirst({ select: { id: true } });
  if (!org) throw new Error("loadDemoBusiness: no deployment organization found");

  // Guardrail — never clobber a real operating business (spec §4).
  if (!options.force) {
    const counts = await nonDemoDataCounts(db);
    if (!isSafeToLoadDemo(counts)) {
      throw new Error(
        `loadDemoBusiness: refusing to load over non-demo data ` +
          `(${counts.bookings} bookings, ${counts.invoices} invoices). Pass force:true to override.`,
      );
    }
  }

  // 1. Set the org archetype (reseeds sections/items/provider) via the existing path.
  const reset = await resetStorefrontArchetype({
    organizationId: org.id,
    targetArchetypeId: archetypeId,
    mode: "replace-seeded-content",
  });
  const { storefrontId } = reset;

  // Real items to attach demo bookings to.
  const items = await db.storefrontItem.findMany({
    where: { storefrontId },
    select: { itemId: true },
  });
  const itemIds = items.map((i) => i.itemId);
  if (itemIds.length === 0) {
    throw new Error(`loadDemoBusiness: archetype "${archetypeId}" seeded no storefront items`);
  }

  // 2. Generate + plan. Enrichment (playbook KPIs, who-we-serve) is wired in here
  //    because those helpers live in the app; the package core stays pure.
  const playbook = getPlaybook(archetype.category, archetype.ctaType);
  const businessProfile = resolveBusinessProfile({
    archetypeId: archetype.archetypeId,
    industry: archetype.category,
  });
  const demo = deriveDemoBusiness(archetype, {
    flavor: options.flavor,
    playbook: { primaryGoal: playbook.primaryGoal, keyMetrics: playbook.keyMetrics },
    businessProfile: { whoWeServe: businessProfile.whoWeServe },
  });
  const plan: DemoLoadPlan = planDemoLoad(demo, { storefrontId, itemIds });

  // 3. Upsert the plan (parents first so FK targets exist; demo-tagged, idempotent).
  const employees = await upsertEmployees(db, plan);
  const supplierIdByRef = await upsertSuppliers(db, plan);
  const providerIdByRef = await upsertProviders(db, plan, storefrontId);
  await upsertBills(db, plan, supplierIdByRef, now);
  const bookings = await upsertBookings(
    db,
    plan,
    org.id,
    storefrontId,
    providerIdByRef,
    now,
  );
  if (archetypeId === "restaurant") {
    await persistRestaurantDemoFloor({
      database: db as unknown as RestaurantDemoFloorDatabase,
      organizationId: org.id,
      storefrontId,
      providerIds: plan.providers.map((provider) =>
        providerIdByRef.get(provider.providerId)!,
      ),
      bookings,
      employees,
      now,
      timezone: demo.timezone,
    });
  }

  // 4. Setup-completion seeds (WWWD priming corpus etc.) — best-effort. The demo's
  //    operational-twin data (steps 1–3) is the deliverable; priming is enrichment,
  //    so a seed failure (e.g. embedding service down) must not abort the load.
  let primed = true;
  try {
    await runSetupCompletionSeeds(org.id);
  } catch (err) {
    primed = false;
    console.warn(`loadDemoBusiness: setup-completion seeds failed (non-fatal): ${String(err)}`);
  }

  return {
    archetypeId,
    storefrontId,
    seededAt: now,
    primed,
    counts: {
      providers: plan.providers.length,
      bookings: plan.bookings.length,
      bills: plan.bills.length,
      suppliers: plan.suppliers.length,
      employees: plan.employees.length,
    },
  };
}

async function upsertEmployees(
  db: Db,
  plan: DemoLoadPlan,
): Promise<Array<{ id: string; displayName: string; role: string }>> {
  const employees: Array<{ id: string; displayName: string; role: string }> = [];
  for (const e of plan.employees) {
    const row = await db.employeeProfile.upsert({
      where: { employeeId: e.employeeRef },
      create: {
        employeeId: e.employeeRef,
        firstName: e.firstName,
        lastName: e.lastName,
        displayName: e.displayName,
      },
      update: { firstName: e.firstName, lastName: e.lastName, displayName: e.displayName },
      select: { id: true },
    });
    employees.push({ id: row.id, displayName: e.displayName, role: e.role });
  }
  return employees;
}

async function upsertSuppliers(db: Db, plan: DemoLoadPlan): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const s of plan.suppliers) {
    const row = await db.supplier.upsert({
      where: { supplierId: s.supplierId },
      create: { supplierId: s.supplierId, name: s.name },
      update: { name: s.name },
      select: { id: true },
    });
    map.set(s.supplierId, row.id);
  }
  return map;
}

async function upsertProviders(
  db: Db,
  plan: DemoLoadPlan,
  storefrontId: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const p of plan.providers) {
    const row = await db.serviceProvider.upsert({
      where: { providerId: p.providerId },
      create: { providerId: p.providerId, storefrontId, name: p.name, isActive: p.isActive },
      update: { name: p.name, isActive: p.isActive, storefrontId },
      select: { id: true },
    });
    map.set(p.providerId, row.id);
  }
  return map;
}

async function upsertBills(
  db: Db,
  plan: DemoLoadPlan,
  supplierIdByRef: Map<string, string>,
  now: Date,
): Promise<void> {
  for (const b of plan.bills) {
    const supplierId = supplierIdByRef.get(b.supplierId);
    if (!supplierId) continue; // planner guarantees a supplier; defensive
    const issueDate = new Date(now.getTime() - b.issuedDaysAgo * DAY);
    const dueDate = new Date(now.getTime() + b.dueInDays * DAY);
    const money = { subtotal: b.subtotal, totalAmount: b.totalAmount, amountDue: b.amountDue };
    await db.bill.upsert({
      where: { billRef: b.billRef },
      create: {
        billRef: b.billRef,
        supplierId,
        issueDate,
        dueDate,
        currency: b.currency,
        status: b.status,
        ...money,
      },
      update: { supplierId, issueDate, dueDate, currency: b.currency, status: b.status, ...money },
    });
  }
}

async function upsertBookings(
  db: Db,
  plan: DemoLoadPlan,
  organizationId: string,
  storefrontId: string,
  providerIdByRef: Map<string, string>,
  now: Date,
): Promise<Array<{ id: string; bookingRef: string }>> {
  const bookings: Array<{ id: string; bookingRef: string }> = [];
  for (const bk of plan.bookings) {
    const providerId = bk.providerId ? providerIdByRef.get(bk.providerId) ?? null : null;
    const scheduledAt = new Date(now.getTime() + bk.scheduledInMinutes * MIN);
    const createdAt = new Date(now.getTime() - bk.createdMinutesAgo * MIN);
    const row = await db.storefrontBooking.upsert({
      where: { bookingRef: bk.bookingRef },
      create: {
        bookingRef: bk.bookingRef,
        organizationId,
        storefrontId,
        itemId: bk.itemId,
        providerId,
        customerName: bk.customerName,
        customerEmail: bk.customerEmail,
        scheduledAt,
        durationMinutes: bk.durationMinutes,
        status: bk.status,
        createdAt,
      },
      update: {
        providerId,
        scheduledAt,
        status: bk.status,
        customerName: bk.customerName,
        customerEmail: bk.customerEmail,
      },
      select: { id: true },
    });
    bookings.push({ id: row.id, bookingRef: bk.bookingRef });
  }
  return bookings;
}

export interface UnloadDemoBusinessResult {
  removed: {
    bookings: number;
    providers: number;
    bills: number;
    suppliers: number;
    employees: number;
  };
}

/**
 * Remove every demo row (children before parents so FK constraints hold). Scope
 * to one archetype's prefix when given, else remove all demo rows.
 */
export async function unloadDemoBusiness(
  options: { archetypeId?: string; db?: Db } = {},
): Promise<UnloadDemoBusinessResult> {
  const db = options.db ?? prisma;
  const spec = demoTeardownSpec(options.archetypeId);

  if (!options.archetypeId || options.archetypeId === "restaurant") {
    const restaurantStorefronts = await db.storefrontConfig.findMany({
      where: { archetype: { archetypeId: "restaurant" } },
      select: { id: true },
    });
    await removeRestaurantDemoFloor(
      db as unknown as RestaurantDemoFloorDatabase,
      { storefrontIds: restaurantStorefronts.map((storefront) => storefront.id) },
    );
  }

  const bookings = await db.storefrontBooking.deleteMany({
    where: { bookingRef: { startsWith: spec.bookingRefPrefix } },
  });
  const providers = await db.serviceProvider.deleteMany({
    where: { providerId: { startsWith: spec.providerRefPrefix } },
  });
  const bills = await db.bill.deleteMany({ where: { billRef: { startsWith: spec.billRefPrefix } } });
  const suppliers = await db.supplier.deleteMany({
    where: { supplierId: { startsWith: spec.supplierRefPrefix } },
  });
  const employees = await db.employeeProfile.deleteMany({
    where: { employeeId: { startsWith: spec.employeeRefPrefix } },
  });

  return {
    removed: {
      bookings: bookings.count,
      providers: providers.count,
      bills: bills.count,
      suppliers: suppliers.count,
      employees: employees.count,
    },
  };
}
