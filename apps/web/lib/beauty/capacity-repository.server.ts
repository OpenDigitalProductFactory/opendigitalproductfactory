import { prisma } from "@dpf/db";
import type { CapacityAdapterLoadInput } from "@/lib/capacity/adapter-types";
import { expandBeautyAvailability, type BeautyAvailabilityRow } from "./availability";
import {
  createBeautyCapacityAdapter,
  type BeautyCapacityFacts,
} from "./capacity-adapter";

interface BeautyCapacityDatabase {
  storefrontConfig: {
    findFirst(args: unknown): Promise<{ id: string; timezone: string } | null>;
  };
  beautyResource: {
    findMany(args: unknown): Promise<Array<{
      id: string;
      organizationId: string;
      kind: string;
      label: string;
      status: string;
      capacity: number;
      capacityUnit: string;
      serviceArea: string | null;
      blockedReason: string | null;
      version: number;
      services: Array<{ itemId: string }>;
      availability: BeautyAvailabilityRow[];
      allocations: Array<{
        allocationId: string;
        resourceId: string;
        demandRef: string;
        startsAt: Date;
        endsAt: Date;
        quantity: number;
        lifecycle: string;
        version: number;
      }>;
    }>>;
  };
  storefrontBooking: {
    findMany(args: unknown): Promise<Array<{
      id: string;
      bookingRef: string;
      itemId: string;
      providerId: string | null;
      customerName: string;
      scheduledAt: Date;
      durationMinutes: number;
      status: string;
      covers: number | null;
      demandKind: string;
      provider: { name: string } | null;
    }>>;
  };
  storefrontItem: {
    findMany(args: unknown): Promise<Array<{ id: string; bookingConfig: unknown }>>;
  };
}

function bookingBuffers(raw: unknown): { before: number; after: number } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { before: 0, after: 0 };
  const config = raw as Record<string, unknown>;
  const minutes = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0
      ? Math.floor(value)
      : 0;
  return {
    before: minutes(config.beforeBufferMinutes),
    after: minutes(config.afterBufferMinutes),
  };
}

export async function loadBeautyCapacityFacts(
  database: BeautyCapacityDatabase,
  input: CapacityAdapterLoadInput,
): Promise<BeautyCapacityFacts> {
  const windowStart = new Date(input.window.startAt);
  const windowEnd = new Date(input.window.endAt);
  if (!Number.isFinite(windowStart.getTime()) || !Number.isFinite(windowEnd.getTime()) || windowEnd <= windowStart) {
    throw new Error("Beauty capacity window is invalid");
  }
  const storefront = await database.storefrontConfig.findFirst({
    where: { organizationId: input.organizationId },
    select: { id: true, timezone: true },
  });
  if (!storefront) throw new Error("Beauty storefront is unavailable");

  const [resources, bookings, items] = await Promise.all([
    database.beautyResource.findMany({
      where: { organizationId: input.organizationId, storefrontId: storefront.id },
      select: {
        id: true,
        organizationId: true,
        kind: true,
        label: true,
        status: true,
        capacity: true,
        capacityUnit: true,
        serviceArea: true,
        blockedReason: true,
        version: true,
        services: { select: { itemId: true } },
        availability: {
          where: {
            OR: [
              { startsAt: null },
              { startsAt: { lt: windowEnd }, endsAt: { gt: windowStart } },
            ],
          },
          select: {
            availabilityId: true,
            resourceId: true,
            kind: true,
            days: true,
            startTime: true,
            endTime: true,
            date: true,
            startsAt: true,
            endsAt: true,
            reason: true,
          },
        },
        allocations: {
          where: { startsAt: { lt: windowEnd }, endsAt: { gt: windowStart } },
          select: {
            allocationId: true,
            resourceId: true,
            demandRef: true,
            startsAt: true,
            endsAt: true,
            quantity: true,
            lifecycle: true,
            version: true,
          },
        },
      },
      orderBy: [{ kind: "asc" }, { label: "asc" }],
    }),
    database.storefrontBooking.findMany({
      where: {
        organizationId: input.organizationId,
        storefrontId: storefront.id,
        scheduledAt: {
          gte: new Date(windowStart.getTime() - 24 * 60 * 60_000),
          lt: windowEnd,
        },
        status: { notIn: ["cancelled", "canceled", "completed", "void"] },
      },
      select: {
        id: true,
        bookingRef: true,
        itemId: true,
        providerId: true,
        customerName: true,
        scheduledAt: true,
        durationMinutes: true,
        status: true,
        covers: true,
        demandKind: true,
        provider: { select: { name: true } },
      },
      orderBy: [{ scheduledAt: "asc" }, { bookingRef: "asc" }],
    }),
    database.storefrontItem.findMany({
      where: { storefrontId: storefront.id, isActive: true },
      select: { id: true, bookingConfig: true },
    }),
  ]);

  const configByItem = new Map(items.map((item) => [item.id, bookingBuffers(item.bookingConfig)]));
  const availabilityRows = resources.flatMap((resource) => resource.availability);
  const bookingFacts = bookings.map((booking) => {
    const config = configByItem.get(booking.itemId);
    return {
      ...booking,
      providerName: booking.provider?.name ?? null,
      preparationMinutes: config?.before ?? 0,
      cleanupMinutes: config?.after ?? 0,
      requiredResourceCount: booking.demandKind === "group-booking"
        ? Math.max(1, booking.covers ?? 1)
        : 1,
    };
  }).filter((booking) => {
    const footprintStart = booking.scheduledAt.getTime() - booking.preparationMinutes * 60_000;
    const footprintEnd = booking.scheduledAt.getTime() +
      (booking.durationMinutes + booking.cleanupMinutes) * 60_000;
    return footprintStart < windowEnd.getTime() && footprintEnd > windowStart.getTime();
  });
  return {
    observedAt: new Date(),
    sourceVersion: String(Math.max(
      0,
      ...resources.map((resource) => resource.version),
      ...resources.flatMap((resource) => resource.allocations.map((allocation) => allocation.version)),
    )),
    resources: resources.map((resource) => ({
      ...resource,
      kind: resource.kind as "chair" | "station" | "room",
      serviceItemIds: resource.services.map((service) => service.itemId),
    })),
    availability: expandBeautyAvailability({
      rows: availabilityRows,
      windowStart,
      windowEnd,
      timeZone: storefront.timezone,
    }),
    allocations: resources.flatMap((resource) => resource.allocations).map((allocation) => ({
      ...allocation,
      lifecycle: allocation.lifecycle as "held" | "confirmed" | "active" | "released" | "cancelled",
    })),
    bookings: bookingFacts,
  };
}

export const beautyCapacityAdapter = createBeautyCapacityAdapter((input) =>
  loadBeautyCapacityFacts(prisma as unknown as BeautyCapacityDatabase, input)
);
