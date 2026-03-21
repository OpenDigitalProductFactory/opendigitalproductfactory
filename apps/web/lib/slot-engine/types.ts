import { bookingConfigSchema } from "@dpf/validators";

/** A contiguous time window in minutes-since-midnight (local time) */
export interface TimeWindow {
  startMinutes: number; // 0-1439
  endMinutes: number;   // 1-1440
}

/** A busy period in minutes-since-midnight */
export interface BusyPeriod {
  startMinutes: number;
  endMinutes: number;
}

/** A generated slot candidate */
export interface SlotCandidate {
  startMinutes: number;
  endMinutes: number;
  providerId: string;
  providerName: string;
  providerAvatarUrl?: string | null;
}

/** Provider availability row (from DB) */
export interface AvailabilityRow {
  days: number[];
  startTime: string; // "HH:MM"
  endTime: string;   // "HH:MM"
  date: Date | null;
  isBlocked: boolean;
}

/** Resolved booking config with defaults applied */
export interface ResolvedBookingConfig {
  durationMinutes: number;
  beforeBufferMinutes: number;
  afterBufferMinutes: number;
  minimumNoticeHours: number;
  maxAdvanceDays: number;
  slotIntervalMinutes: number;
  schedulingPattern: "slot" | "class" | "recurring";
  assignmentMode: "next-available" | "customer-choice";
  capacity: number;
  bookingLimits: { day?: number; week?: number; month?: number };
}

export function resolveBookingConfig(raw: Record<string, unknown>): ResolvedBookingConfig {
  const parsed = bookingConfigSchema.safeParse(raw);
  const cfg = parsed.success ? parsed.data : raw;
  const dur = typeof cfg.durationMinutes === "number" ? cfg.durationMinutes : 60;

  function num(v: unknown, fallback: number): number {
    return typeof v === "number" ? v : fallback;
  }
  function str<T extends string>(v: unknown, fallback: T): T {
    return typeof v === "string" ? (v as T) : fallback;
  }

  return {
    durationMinutes: dur,
    beforeBufferMinutes: num(cfg.beforeBufferMinutes, 0),
    afterBufferMinutes: num(cfg.afterBufferMinutes, 0),
    minimumNoticeHours: num(cfg.minimumNoticeHours, 1),
    maxAdvanceDays: num(cfg.maxAdvanceDays, 60),
    slotIntervalMinutes: num(cfg.slotIntervalMinutes, dur),
    schedulingPattern: str<"slot" | "class" | "recurring">(cfg.schedulingPattern, "slot"),
    assignmentMode: str<"next-available" | "customer-choice">(cfg.assignmentMode, "next-available"),
    capacity: num(cfg.capacity, 1),
    bookingLimits: (cfg.bookingLimits ?? {}) as { day?: number; week?: number; month?: number },
  };
}
