import { newId } from "@/lib/shared/new-id";
import { ALL_ARCHETYPES } from "@dpf/storefront-templates";

/**
 * Narrow structural view of the Prisma client used by the booking seeder.
 *
 * Hand-rolled (not `PrismaClient` / `Prisma.TransactionClient`) on purpose:
 * naming the Prisma client type here forces every importer to compute Prisma's
 * large `Omit<PrismaClient, …>` mapped type, which has blown the typecheck heap
 * (OOM) elsewhere in this repo — see the same note on
 * `ProjectArchetypeValueStreamInput.db`. Callers pass `prisma` or a
 * `$transaction` client; both satisfy this shape structurally.
 */
type IdRow = { id: string };
interface BookingSeedDb {
  serviceProvider: {
    findMany(args: unknown): Promise<IdRow[]>;
    create(args: unknown): Promise<IdRow>;
  };
  providerAvailability: {
    count(args: unknown): Promise<number>;
    create(args: unknown): Promise<unknown>;
  };
  providerService: {
    createMany(args: unknown): Promise<{ count: number }>;
  };
  storefrontItem: {
    findMany(args: unknown): Promise<IdRow[]>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  businessProfile: {
    findFirst(args: unknown): Promise<{ businessHours: unknown } | null>;
  };
}

type OperatingHour = { day: number; start: string; end: string };

/**
 * Defence-in-depth scheduling for an archetype that has booking items but no
 * explicit `schedulingDefaults` (a template-config gap). Every shipped archetype
 * with a booking item carries explicit `schedulingDefaults` (guarded by
 * archetypes.test.ts); this fallback ensures a future archetype can never
 * regress to the empty-calendar bug (AUDIT-R3/R4, R9-RES-001).
 */
const FALLBACK_SCHEDULING = {
  schedulingPattern: "slot" as const,
  assignmentMode: "next-available" as const,
  defaultOperatingHours: [1, 2, 3, 4, 5].map((day) => ({ day, start: "09:00", end: "17:00" })),
  defaultBeforeBuffer: 0,
  defaultAfterBuffer: 0,
  minimumNoticeHours: 2,
  maxAdvanceDays: 60,
};

const DAY_NAME_TO_INDEX: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

/**
 * Ensure every booking item on a storefront has a working calendar: a default
 * provider, recurring availability, provider→item links, and per-item
 * `bookingConfig` — derived from the archetype template's scheduling defaults.
 *
 * Idempotent and safe to re-run on an existing storefront (the archetype-reset
 * path): a provider is created only when none exists, and availability is seeded
 * only for a provider that has none, so operator-customized hours are never
 * clobbered. It always (re)links providers to the current booking items and
 * (re)writes each booking item's `bookingConfig` from the template — those are
 * freshly seeded by the reset and carry no operator edits.
 *
 * Shared by storefront setup (initial install) and archetype reset so the two
 * seed paths can never drift — reset used to skip this entirely, shipping an
 * empty booking calendar with every date greyed out (R9-RES-001).
 *
 * @returns true when the archetype has booking items and defaults were applied;
 *          false (a no-op) for a non-booking archetype.
 *
 * `dbClient` is a `PrismaClient` or a `$transaction` client, typed `unknown` and
 * cast to the narrow {@link BookingSeedDb} at the boundary — naming the Prisma
 * client type in the signature forces importers to compute its large mapped type
 * and has blown the typecheck heap before (see `BookingSeedDb`).
 */
export async function seedBookingScheduleDefaults(
  dbClient: unknown,
  input: { storefrontId: string; archetypeId: string; providerName: string },
): Promise<boolean> {
  const db = dbClient as BookingSeedDb;
  const { storefrontId, archetypeId, providerName } = input;

  const template = ALL_ARCHETYPES.find((a) => a.archetypeId === archetypeId);
  if (!template) return false;

  const templateCtaType = template.ctaType;
  const hasBookingItems = template.itemTemplates.some(
    (t) => (t.ctaType ?? templateCtaType) === "booking",
  );
  const defaults = template.schedulingDefaults ?? (hasBookingItems ? FALLBACK_SCHEDULING : null);
  if (!defaults) return false;

  // 1. Ensure at least one active provider. Reuse an existing one (e.g. a
  //    survivor from a prior archetype) rather than creating duplicates; create
  //    a default provider only when none exists.
  let providers = await db.serviceProvider.findMany({
    where: { storefrontId, isActive: true },
    select: { id: true },
  });
  if (providers.length === 0) {
    const provider = await db.serviceProvider.create({
      data: {
        providerId: `SP-${newId(6).toUpperCase()}`,
        storefrontId,
        name: providerName,
        isActive: true,
      },
      select: { id: true },
    });
    providers = [provider];
  }

  // 2. Resolve operating hours — prefer the operator's confirmed BusinessProfile
  //    hours over the template defaults, matching storefront setup.
  const operatingHours = await resolveOperatingHours(db, defaults.defaultOperatingHours);
  const grouped = new Map<string, number[]>();
  for (const h of operatingHours) {
    const key = `${h.start}-${h.end}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(h.day);
  }

  // 3. Seed availability for any provider that has none (never overwrite
  //    existing/operator-edited hours).
  for (const provider of providers) {
    const availCount = await db.providerAvailability.count({
      where: { providerId: provider.id },
    });
    if (availCount > 0) continue;
    for (const [key, days] of grouped) {
      const keyParts = key.split("-");
      const startTime = keyParts[0] ?? "09:00";
      const endTime = keyParts[1] ?? "17:00";
      await db.providerAvailability.create({
        data: { providerId: provider.id, days, startTime, endTime },
      });
    }
  }

  // 4. Link every active provider to every current booking item.
  const bookingItems = await db.storefrontItem.findMany({
    where: { storefrontId, ctaType: "booking" },
    select: { id: true },
  });
  if (bookingItems.length > 0) {
    for (const provider of providers) {
      await db.providerService.createMany({
        data: bookingItems.map((item) => ({ providerId: provider.id, itemId: item.id })),
        skipDuplicates: true,
      });
    }
  }

  // 5. Write bookingConfig on each booking item from the template + defaults.
  for (const tmpl of template.itemTemplates) {
    if ((tmpl.ctaType ?? templateCtaType) !== "booking") continue;
    await db.storefrontItem.updateMany({
      where: { storefrontId, name: tmpl.name },
      data: {
        bookingConfig: {
          durationMinutes: tmpl.bookingDurationMinutes ?? 60,
          schedulingPattern: defaults.schedulingPattern,
          assignmentMode: defaults.assignmentMode,
          beforeBufferMinutes: defaults.defaultBeforeBuffer,
          afterBufferMinutes: defaults.defaultAfterBuffer,
          minimumNoticeHours: defaults.minimumNoticeHours,
          maxAdvanceDays: defaults.maxAdvanceDays,
        },
      },
    });
  }

  return true;
}

/**
 * Prefer the operator's confirmed BusinessProfile hours; fall back to the
 * template defaults. A confirmed-but-empty schedule (every day closed) would
 * otherwise wipe the calendar, so fall back there too — a booking storefront
 * needs some bookable window to be usable.
 */
async function resolveOperatingHours(
  db: BookingSeedDb,
  fallback: OperatingHour[],
): Promise<OperatingHour[]> {
  const profile = await db.businessProfile.findFirst({
    where: { isActive: true, hoursConfirmedAt: { not: null } },
    select: { businessHours: true },
  });
  const businessHours = profile?.businessHours as
    | Record<string, { open: string; close: string } | null>
    | undefined
    | null;
  if (!businessHours) return fallback;

  const hours = Object.entries(businessHours)
    .filter(([, h]) => h !== null)
    .map(([day, h]) => ({
      day: DAY_NAME_TO_INDEX[day] ?? 0,
      start: h!.open,
      end: h!.close,
    }));
  return hours.length > 0 ? hours : fallback;
}
