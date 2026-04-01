import { z } from "zod";

export const EXPENSE_CATEGORIES = ["travel", "meals", "accommodation", "supplies", "mileage", "other"] as const;
export const CLAIM_STATUSES = ["draft", "submitted", "approved", "rejected", "paid"] as const;

const expenseItemSchema = z.object({
  date: z.string().min(1),
  category: z.enum(EXPENSE_CATEGORIES),
  description: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().length(3).default("GBP"),
  receiptUrl: z.string().optional(),
  taxReclaimable: z.boolean().default(false),
  taxAmount: z.number().min(0).default(0),
  accountCode: z.string().optional(),
});

export const createExpenseClaimSchema = z.object({
  title: z.string().min(1),
  currency: z.string().length(3).default("GBP"),
  notes: z.string().optional(),
  items: z.array(expenseItemSchema).min(1),
});

export const updateExpenseClaimSchema = z.object({
  status: z.enum(CLAIM_STATUSES).optional(),
  rejectedReason: z.string().optional(),
});

export type CreateExpenseClaimInput = z.infer<typeof createExpenseClaimSchema>;
export type UpdateExpenseClaimInput = z.infer<typeof updateExpenseClaimSchema>;
