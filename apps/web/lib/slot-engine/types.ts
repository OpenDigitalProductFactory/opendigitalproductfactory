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
  return {
    durationMinutes: dur,
    beforeBufferMinutes: cfg.beforeBufferMinutes ?? 0,
    afterBufferMinutes: cfg.afterBufferMinutes ?? 0,
    minimumNoticeHours: cfg.minimumNoticeHours ?? 1,
    maxAdvanceDays: cfg.maxAdvanceDays ?? 60,
    slotIntervalMinutes: cfg.slotIntervalMinutes ?? dur,
    schedulingPattern: cfg.schedulingPattern ?? "slot",
    assignmentMode: cfg.assignmentMode ?? "next-available",
    capacity: cfg.capacity ?? 1,
    bookingLimits: cfg.bookingLimits ?? {},
  };
}
