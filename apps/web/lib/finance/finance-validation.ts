import { z } from "zod";

export const INVOICE_TYPES = ["standard", "credit_note", "proforma", "recurring_instance"] as const;
export const INVOICE_STATUSES = [
  "draft", "approved", "sent", "viewed", "partially_paid", "paid", "overdue", "void", "written_off",
] as const;
export const PAYMENT_DIRECTIONS = ["inbound", "outbound"] as const;
export const PAYMENT_METHODS = [
  "bank_transfer", "card", "cash", "cheque", "direct_debit", "stripe",
] as const;
export const PAYMENT_STATUSES = [
  "pending", "completed", "failed", "refunded", "cancelled",
] as const;

const lineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  taxRate: z.number().min(0).max(100).default(0),
  discountPercent: z.number().min(0).max(100).default(0),
  accountCode: z.string().optional(),
});

export const createInvoiceSchema = z.object({
  accountId: z.string().min(1),
  contactId: z.string().optional(),
  type: z.enum(INVOICE_TYPES).default("standard"),
  dueDate: z.string().min(1),
  currency: z.string().length(3).default("GBP"),
  paymentTerms: z.string().optional(),
  notes: z.string().optional(),
  internalNotes: z.string().optional(),
  sourceType: z.string().optional(),
  sourceId: z.string().optional(),
  lineItems: z.array(lineItemSchema).min(1),
});

export const updateInvoiceSchema = z.object({
  status: z.enum(INVOICE_STATUSES).optional(),
  dueDate: z.string().optional(),
  paymentTerms: z.string().optional(),
  notes: z.string().optional(),
  internalNotes: z.string().optional(),
});

export const recordPaymentSchema = z.object({
  direction: z.enum(PAYMENT_DIRECTIONS),
  method: z.enum(PAYMENT_METHODS),
  amount: z.number().positive(),
  currency: z.string().length(3).default("GBP"),
  reference: z.string().optional(),
  invoiceId: z.string().optional(),
  notes: z.string().optional(),
  receivedAt: z.string().optional(),
});

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>;
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
