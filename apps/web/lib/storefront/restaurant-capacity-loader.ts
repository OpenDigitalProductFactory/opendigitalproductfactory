// apps/web/lib/storefront/restaurant-capacity-loader.ts
//
// Server-side loader that turns the deployment's live storefront substrate into
// one `RestaurantCapacitySnapshot`. This is the ONE place the owner Tables &
// Capacity page and the Workspace readiness answer both read from — so they
// reconcile by construction (BI-7C95A586 / BI-348766E5). Injected client +
// fail-soft reads mirror `living-business-snapshot.ts`.
//
// Only FLOOR-template archetypes (Restaurant) have capacity resources; the loader
// returns null for everything else and the caller keeps its generic view.

import { ALL_ARCHETYPES, deriveTwinProfile } from "@dpf/storefront-templates";

import {
  deriveRestaurantCapacity,
  resolveServicePeriod,
  type CapacityBookingInput,
  type CapacityHoldInput,
  type CapacityResourceInput,
  type OperatingWindow,
  type RestaurantCapacitySnapshot,
} from "./restaurant-capacity";

type FindMany = (args: unknown) => Promise<unknown>;
export interface CapacityLoaderClient {
  storefrontConfig: { findFirst: (args: unknown) => Promise<unknown> };
  serviceProvider: { findMany: FindMany };
  storefrontBooking: { findMany: FindMany };
  bookingHold: { findMany: FindMany };
  businessProfile: { findFirst: (args: unknown) => Promise<unknown> };
}

interface ProviderRow {
  id: string;
  name: string;
  isActive: boolean;
}
interface BookingRow {
  id: string;
  providerId: string | null;
  scheduledAt: Date | null;
  durationMinutes: number | null;
  status: string;
}
interface HoldRow {
  providerId: string | null;
  slotStart: Date | null;
  slotEnd: Date | null;
}

const DAY_NAME_TO_INDEX: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

export interface LoadedCapacity {
  snapshot: RestaurantCapacitySnapshot;
  archetypeId: string;
  hasCapacity: true;
}

/**
 * Load the live capacity snapshot for the single org. Returns null when there is
 * no storefront, no archetype template, or the archetype is not a capacity
 * (FLOOR) archetype — the caller falls back to its non-capacity view.
 */
export async function loadRestaurantCapacitySnapshot(opts?: {
  db?: CapacityLoaderClient;
  now?: Date;
}): Promise<LoadedCapacity | null> {
  const db = opts?.db ?? ((await import("@dpf/db")).prisma as unknown as CapacityLoaderClient);
  const now = opts?.now ?? new Date();

  const config = (await db.storefrontConfig.findFirst({
    select: { id: true, archetype: { select: { archetypeId: true } } },
  })) as { id: string; archetype: { archetypeId: string } | null } | null;

  const archetypeId = config?.archetype?.archetypeId;
  if (!config || !archetypeId) return null;

  const def = ALL_ARCHETYPES.find((a) => a.archetypeId === archetypeId);
  if (!def) return null;
  const profile = deriveTwinProfile(def);
  if (profile.template !== "FLOOR") return null; // not a capacity archetype

  const [providers, bookings, holds, businessProfile] = await Promise.all([
    db.serviceProvider
      .findMany({ where: { storefrontId: config.id }, select: { id: true, name: true, isActive: true } })
      .catch(() => []) as Promise<ProviderRow[]>,
    db.storefrontBooking
      .findMany({
        where: { storefrontId: config.id, status: { notIn: ["cancelled", "completed", "void", "no_show"] } },
        select: { id: true, providerId: true, scheduledAt: true, durationMinutes: true, status: true },
      })
      .catch(() => []) as Promise<BookingRow[]>,
    db.bookingHold
      .findMany({
        where: { storefrontId: config.id, expiresAt: { gt: now } },
        select: { providerId: true, slotStart: true, slotEnd: true },
      })
      .catch(() => []) as Promise<HoldRow[]>,
    db.businessProfile
      .findFirst({ where: { isActive: true, hoursConfirmedAt: { not: null } }, select: { businessHours: true } })
      .catch(() => null) as Promise<{ businessHours: unknown } | null>,
  ]);

  const windows = resolveOperatingWindows(businessProfile?.businessHours, def);
  const nextPeriod = resolveServicePeriod(windows, now);

  const snapshot = deriveRestaurantCapacity({
    resources: providers as CapacityResourceInput[],
    bookings: bookings as CapacityBookingInput[],
    holds: holds as CapacityHoldInput[],
    now,
    nextPeriod,
  });

  return { snapshot, archetypeId, hasCapacity: true };
}

/** Prefer the operator's confirmed hours; fall back to the archetype template. */
function resolveOperatingWindows(
  businessHours: unknown,
  def: (typeof ALL_ARCHETYPES)[number],
): OperatingWindow[] {
  const bh = businessHours as Record<string, { open: string; close: string } | null> | null | undefined;
  if (bh) {
    const windows = Object.entries(bh)
      .filter(([, h]) => h != null)
      .map(([day, h]) => ({ day: DAY_NAME_TO_INDEX[day.toLowerCase()] ?? 0, start: h!.open, end: h!.close }));
    if (windows.length > 0) return windows;
  }
  return (def.schedulingDefaults?.defaultOperatingHours ?? []).map((h) => ({
    day: h.day,
    start: h.start,
    end: h.end,
  }));
}
