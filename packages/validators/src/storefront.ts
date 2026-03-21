import { z } from "zod";

export const bookingLimitsSchema = z.object({
  day: z.number().int().positive().optional(),
  week: z.number().int().positive().optional(),
  month: z.number().int().positive().optional(),
}).strict();

export const bookingConfigSchema = z.object({
  durationMinutes: z.number().int().min(5).max(480),
  beforeBufferMinutes: z.number().int().min(0).max(120).optional(),
  afterBufferMinutes: z.number().int().min(0).max(120).optional(),
  minimumNoticeHours: z.number().min(0).max(720).optional(),
  maxAdvanceDays: z.number().int().min(1).max(365).optional(),
  slotIntervalMinutes: z.number().int().min(5).max(480).optional(),
  schedulingPattern: z.enum(["slot", "class", "recurring"]),
  assignmentMode: z.enum(["next-available", "customer-choice"]),
  capacity: z.number().int().min(1).max(500).optional(),
  bookingLimits: bookingLimitsSchema.optional(),
}).strict();
