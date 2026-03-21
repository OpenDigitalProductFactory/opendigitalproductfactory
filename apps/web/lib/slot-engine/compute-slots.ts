import { prisma } from "@dpf/db";
import { buildAvailabilityWindows } from "./availability";
import { generateSlotCandidates } from "./slot-generator";
import { selectProviderRoundRobin } from "./provider-assignment";
import { resolveBookingConfig } from "./types";
import type { BusyPeriod, SlotCandidate } from "./types";

// ── Return types ────────────────────────────────────────────────────

export type AvailableSlot = {
  startTime: string;           // "09:00" (local to storefront timezone)
  endTime: string;             // "09:45"
  providerId?: string;         // Pre-assigned for next-available; undefined for customer-choice
  providerName?: string;       // Display name
  remainingCapacity?: number;  // For class pattern
};

export type SlotsByProvider = {
  provider: { id: string; name: string; avatarUrl?: string | null };
  slots: AvailableSlot[];
};

export type AvailableSlotsResult =
  | { mode: "next-available"; slots: AvailableSlot[] }
  | { mode: "customer-choice"; providers: SlotsByProvider[] }
  | { mode: "class"; slots: AvailableSlot[] };

// ── Helpers ─────────────────────────────────────────────────────────

function minutesToTime(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function utcToLocalMinutes(utcDate: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = formatter.formatToParts(utcDate);
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

/**
 * Get Monday 00:00 and Sunday 23:59 (UTC) for the week containing `date`.
 */
function getWeekBounds(date: Date): { weekStart: Date; weekEnd: Date } {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day; // Monday offset
  const weekStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff));
  const weekEnd = new Date(Date.UTC(weekStart.getUTCFullYear(), weekStart.getUTCMonth(), weekStart.getUTCDate() + 7));
  return { weekStart, weekEnd };
}

// ── computeAvailableSlots ───────────────────────────────────────────

export async function computeAvailableSlots(
  itemId: string,
  dateStr: string,
  options?: { providerId?: string; holderToken?: string }
): Promise<AvailableSlotsResult> {
  // 1. Load config
  const item = await prisma.storefrontItem.findFirst({
    where: { itemId },
    select: {
      id: true,
      itemId: true,
      storefrontId: true,
      bookingConfig: true,
      storefront: { select: { timezone: true, id: true } },
    },
  });
  if (!item) throw new Error("Item not found");

  // 2. Resolve config
  const config = resolveBookingConfig(
    (item.bookingConfig as Record<string, unknown>) ?? {}
  );

  // 3. Validate date
  const targetDate = new Date(dateStr + "T00:00:00Z");
  const now = new Date();
  const noticeThreshold = new Date(now.getTime() + config.minimumNoticeHours * 60 * 60 * 1000);
  // Target date's end of day must be after notice threshold
  const targetEndOfDay = new Date(dateStr + "T23:59:59Z");
  if (targetEndOfDay < noticeThreshold) {
    return emptyResult(config);
  }
  const maxDate = new Date(now.getTime() + config.maxAdvanceDays * 24 * 60 * 60 * 1000);
  if (targetDate > maxDate) {
    return emptyResult(config);
  }

  // 4. Load eligible providers
  const providers = await prisma.serviceProvider.findMany({
    where: {
      storefrontId: item.storefrontId,
      isActive: true,
      ...(options?.providerId ? { id: options.providerId } : {}),
      services: { some: { itemId: item.id } },
    },
  });
  if (providers.length === 0) return emptyResult(config);

  const timezone = item.storefront.timezone ?? "UTC";

  // Day boundaries in UTC for booking queries
  const dayStartUTC = new Date(dateStr + "T00:00:00Z");
  const dayEndUTC = new Date(dateStr + "T23:59:59.999Z");

  // 5. For each provider, build slot candidates
  const providerSlots: Map<string, SlotCandidate[]> = new Map();

  for (const provider of providers) {
    // 5a. Load availability rows
    const availRows = await prisma.providerAvailability.findMany({
      where: { providerId: provider.id },
    });

    // 5b. Build windows
    const windows = buildAvailabilityWindows(
      availRows.map((r) => ({
        days: r.days,
        startTime: r.startTime,
        endTime: r.endTime,
        date: r.date,
        isBlocked: r.isBlocked,
      })),
      targetDate
    );
    if (windows.length === 0) continue;

    // 5c. Load busy bookings on this date
    const bookings = await prisma.storefrontBooking.findMany({
      where: {
        providerId: provider.id,
        scheduledAt: { gte: dayStartUTC, lte: dayEndUTC },
        status: { not: "cancelled" },
      },
    });

    // 5d. Load active holds
    const holds = await prisma.bookingHold.findMany({
      where: {
        providerId: provider.id,
        expiresAt: { gt: new Date() },
        ...(options?.holderToken
          ? { holderToken: { not: options.holderToken } }
          : {}),
      },
    });

    // 5e. Convert bookings to BusyPeriod
    const busyFromBookings: BusyPeriod[] = bookings.map((b) => {
      const startMin = utcToLocalMinutes(b.scheduledAt, timezone);
      const endMin = startMin + b.durationMinutes;
      return { startMinutes: startMin, endMinutes: endMin };
    });

    // 5f. Convert holds to BusyPeriod
    const busyFromHolds: BusyPeriod[] = holds
      .filter((h) => {
        // Only include holds whose slot overlaps our target date
        const holdStart = h.slotStart;
        return holdStart >= dayStartUTC && holdStart <= dayEndUTC;
      })
      .map((h) => {
        const startMin = utcToLocalMinutes(h.slotStart, timezone);
        const endMin = utcToLocalMinutes(h.slotEnd, timezone);
        return { startMinutes: startMin, endMinutes: endMin };
      });

    const allBusy = [...busyFromBookings, ...busyFromHolds];

    // 5g. Generate slot candidates
    const slots = generateSlotCandidates(windows, allBusy, {
      durationMinutes: config.durationMinutes,
      intervalMinutes: config.slotIntervalMinutes,
      beforeBuffer: config.beforeBufferMinutes,
      afterBuffer: config.afterBufferMinutes,
    });

    const mapped: SlotCandidate[] = slots.map((s) => ({
      ...s,
      providerId: provider.id,
      providerName: provider.name,
      providerAvatarUrl: provider.avatarUrl,
    }));

    providerSlots.set(provider.id, mapped);
  }

  // 6. Aggregate by mode
  if (config.assignmentMode === "customer-choice" && config.schedulingPattern !== "class") {
    return aggregateCustomerChoice(providerSlots, providers);
  }

  if (config.schedulingPattern === "class") {
    return aggregateClass(providerSlots, config, dayStartUTC, dayEndUTC, item.storefrontId, item.itemId, timezone);
  }

  // Default: next-available
  return aggregateNextAvailable(providerSlots, providers, targetDate);
}

// ── Mode aggregators ────────────────────────────────────────────────

function emptyResult(config: { assignmentMode: string; schedulingPattern: string }): AvailableSlotsResult {
  if (config.assignmentMode === "customer-choice" && config.schedulingPattern !== "class") {
    return { mode: "customer-choice", providers: [] };
  }
  if (config.schedulingPattern === "class") {
    return { mode: "class", slots: [] };
  }
  return { mode: "next-available", slots: [] };
}

function aggregateCustomerChoice(
  providerSlots: Map<string, SlotCandidate[]>,
  providers: Array<{ id: string; name: string; avatarUrl: string | null }>
): AvailableSlotsResult {
  const result: SlotsByProvider[] = [];
  for (const provider of providers) {
    const slots = providerSlots.get(provider.id) ?? [];
    if (slots.length === 0) continue;
    result.push({
      provider: {
        id: provider.id,
        name: provider.name,
        avatarUrl: provider.avatarUrl,
      },
      slots: slots.map((s) => ({
        startTime: minutesToTime(s.startMinutes),
        endTime: minutesToTime(s.endMinutes),
      })),
    });
  }
  return { mode: "customer-choice", providers: result };
}

async function aggregateNextAvailable(
  providerSlots: Map<string, SlotCandidate[]>,
  providers: Array<{ id: string; name: string; avatarUrl: string | null; priority: number; weight: number }>,
  targetDate: Date
): Promise<AvailableSlotsResult> {
  // Load weekly booking counts for round-robin
  const { weekStart, weekEnd } = getWeekBounds(targetDate);

  const weeklyCountMap: Map<string, number> = new Map();
  for (const provider of providers) {
    const weekBookings = await prisma.storefrontBooking.findMany({
      where: {
        providerId: provider.id,
        scheduledAt: { gte: weekStart, lt: weekEnd },
        status: { not: "cancelled" },
      },
    });
    weeklyCountMap.set(provider.id, weekBookings.length);
  }

  // Collect all unique start times across providers
  const startTimeMap: Map<number, SlotCandidate[]> = new Map();
  for (const [, slots] of providerSlots) {
    for (const slot of slots) {
      const existing = startTimeMap.get(slot.startMinutes) ?? [];
      existing.push(slot);
      startTimeMap.set(slot.startMinutes, existing);
    }
  }

  // For each unique start time, pick the best provider via round-robin
  const sortedTimes = [...startTimeMap.keys()].sort((a, b) => a - b);
  const resultSlots: AvailableSlot[] = [];

  for (const startMin of sortedTimes) {
    const candidates = startTimeMap.get(startMin)!;
    const providerCandidates = candidates.map((c) => {
      const prov = providers.find((p) => p.id === c.providerId)!;
      return {
        id: prov.id,
        name: prov.name,
        priority: prov.priority,
        weight: prov.weight,
        recentBookings: weeklyCountMap.get(prov.id) ?? 0,
      };
    });

    const selected = selectProviderRoundRobin(providerCandidates);
    if (!selected) continue;

    const slotCandidate = candidates.find((c) => c.providerId === selected.id)!;
    resultSlots.push({
      startTime: minutesToTime(slotCandidate.startMinutes),
      endTime: minutesToTime(slotCandidate.endMinutes),
      providerId: selected.id,
      providerName: selected.name,
    });
  }

  return { mode: "next-available", slots: resultSlots };
}

async function aggregateClass(
  providerSlots: Map<string, SlotCandidate[]>,
  config: { capacity: number; durationMinutes: number },
  dayStartUTC: Date,
  dayEndUTC: Date,
  storefrontId: string,
  itemId: string,
  timezone: string
): Promise<AvailableSlotsResult> {
  // For class mode, each slot time is a class window.
  // We need to count existing bookings per slot time.
  // Collect all unique slot times across all providers.
  const slotTimeSet: Map<string, { startMinutes: number; endMinutes: number }> = new Map();
  for (const [, slots] of providerSlots) {
    for (const slot of slots) {
      const key = `${slot.startMinutes}-${slot.endMinutes}`;
      if (!slotTimeSet.has(key)) {
        slotTimeSet.set(key, { startMinutes: slot.startMinutes, endMinutes: slot.endMinutes });
      }
    }
  }

  // Count bookings for each slot time window on this date
  const allBookings = await prisma.storefrontBooking.findMany({
    where: {
      storefrontId,
      itemId,
      scheduledAt: { gte: dayStartUTC, lte: dayEndUTC },
      status: { not: "cancelled" },
    },
  });

  const resultSlots: AvailableSlot[] = [];
  const sortedSlots = [...slotTimeSet.values()].sort((a, b) => a.startMinutes - b.startMinutes);

  for (const slot of sortedSlots) {
    // Count bookings that match this slot time (by scheduled time matching slot start)
    const enrollment = allBookings.filter((b) => {
      const bookingMin = utcToLocalMinutes(b.scheduledAt, timezone);
      return bookingMin === slot.startMinutes;
    }).length;

    const remaining = config.capacity - enrollment;
    if (remaining > 0) {
      resultSlots.push({
        startTime: minutesToTime(slot.startMinutes),
        endTime: minutesToTime(slot.endMinutes),
        remainingCapacity: remaining,
      });
    }
  }

  return { mode: "class", slots: resultSlots };
}

// ── getAvailableDates ───────────────────────────────────────────────

export async function getAvailableDates(
  itemId: string,
  yearMonth: string // "YYYY-MM"
): Promise<string[]> {
  // Load item
  const item = await prisma.storefrontItem.findFirst({
    where: { itemId },
    select: {
      id: true,
      storefrontId: true,
      storefront: { select: { timezone: true } },
    },
  });
  if (!item) return [];

  // Load providers
  const providers = await prisma.serviceProvider.findMany({
    where: {
      storefrontId: item.storefrontId,
      isActive: true,
      services: { some: { itemId: item.id } },
    },
  });
  if (providers.length === 0) return [];

  // Load all availability rows for all providers
  const allAvailRows: Array<{
    providerId: string;
    days: number[];
    startTime: string;
    endTime: string;
    date: Date | null;
    isBlocked: boolean;
  }> = [];

  for (const provider of providers) {
    const rows = await prisma.providerAvailability.findMany({
      where: { providerId: provider.id },
    });
    for (const r of rows) {
      allAvailRows.push({
        providerId: provider.id,
        days: r.days,
        startTime: r.startTime,
        endTime: r.endTime,
        date: r.date,
        isBlocked: r.isBlocked,
      });
    }
  }

  // Iterate each day in the month
  const [yearStr, monthStr] = yearMonth.split("-");
  const year = parseInt(yearStr);
  const month = parseInt(monthStr); // 1-based
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const availableDates: string[] = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(Date.UTC(year, month - 1, day));
    const dayOfWeek = date.getUTCDay();
    const dateStr = `${yearStr}-${monthStr.padStart(2, "0")}-${String(day).padStart(2, "0")}`;

    // Check if any provider has availability on this date
    let hasAvailability = false;
    for (const provider of providers) {
      const providerRows = allAvailRows.filter((r) => r.providerId === provider.id);

      // Check for date-specific overrides first
      const overrides = providerRows.filter(
        (r) => r.date !== null && isSameUTCDate(r.date, date)
      );

      if (overrides.length > 0) {
        // If any override is blocked, skip this provider
        if (overrides.some((r) => r.isBlocked)) continue;
        // Non-blocked override means availability
        hasAvailability = true;
        break;
      }

      // Check recurring rules
      const hasRecurring = providerRows.some(
        (r) => r.date === null && r.days.includes(dayOfWeek)
      );
      if (hasRecurring) {
        hasAvailability = true;
        break;
      }
    }

    if (hasAvailability) {
      availableDates.push(dateStr);
    }
  }

  return availableDates;
}

function isSameUTCDate(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}
