import { z } from "zod";

export const ACCOUNT_TYPES = ["current", "savings", "credit_card", "loan", "merchant"] as const;
export const MATCH_FIELDS = ["payee", "description", "reference"] as const;
export const MATCH_TYPES = ["contains", "exact", "starts_with"] as const;
export const MATCH_STATUSES = ["unmatched", "matched", "manually_matched", "excluded"] as const;

export const createBankAccountSchema = z.object({
  name: z.string().min(1),
  bankName: z.string().optional(),
  accountNumber: z.string().optional(),
  sortCode: z.string().optional(),
  iban: z.string().optional(),
  swift: z.string().optional(),
  currency: z.string().length(3).default("GBP"),
  accountType: z.enum(ACCOUNT_TYPES).default("current"),
  openingBalance: z.number().default(0),
});

export const matchTransactionSchema = z.object({
  transactionId: z.string().min(1),
  paymentId: z.string().min(1),
});

export const createBankRuleSchema = z.object({
  name: z.string().min(1),
  matchField: z.enum(MATCH_FIELDS),
  matchType: z.enum(MATCH_TYPES).default("contains"),
  matchValue: z.string().min(1),
  accountCode: z.string().optional(),
  category: z.string().optional(),
  taxRate: z.number().min(0).max(100).optional(),
  description: z.string().optional(),
});

export type CreateBankAccountInput = z.infer<typeof createBankAccountSchema>;
export type MatchTransactionInput = z.infer<typeof matchTransactionSchema>;
export type CreateBankRuleInput = z.infer<typeof createBankRuleSchema>;
