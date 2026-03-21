import { z } from "zod";

export const FREQUENCIES = ["weekly", "fortnightly", "monthly", "quarterly", "annually"] as const;
export const SCHEDULE_STATUSES = ["active", "paused", "cancelled", "completed"] as const;
export const SEVERITIES = ["friendly", "firm", "final", "escalation"] as const;

export const createRecurringScheduleSchema = z.object({
  accountId: z.string().min(1),
  name: z.string().min(1),
  frequency: z.enum(FREQUENCIES),
  startDate: z.string().min(1),
  endDate: z.string().optional(),
  autoSend: z.boolean().default(true),
  templateNotes: z.string().optional(),
  currency: z.string().length(3).default("GBP"),
  lineItems: z
    .array(
      z.object({
        description: z.string().min(1),
        quantity: z.number().positive(),
        unitPrice: z.number().nonnegative(),
        taxRate: z.number().min(0).max(100).default(0),
      }),
    )
    .min(1),
});

export const updateScheduleStatusSchema = z.object({
  status: z.enum(SCHEDULE_STATUSES),
});

export const createDunningSequenceSchema = z.object({
  name: z.string().min(1),
  isDefault: z.boolean().default(false),
  steps: z
    .array(
      z.object({
        dayOffset: z.number().int(),
        subject: z.string().min(1),
        emailTemplate: z.string().min(1),
        severity: z.enum(SEVERITIES),
      }),
    )
    .min(1),
});

export type CreateRecurringScheduleInput = z.infer<typeof createRecurringScheduleSchema>;
export type CreateDunningSequenceInput = z.infer<typeof createDunningSequenceSchema>;
