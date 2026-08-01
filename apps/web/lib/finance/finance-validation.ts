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
  signatureRequired: z.boolean().optional(),
  lineItems: z.array(lineItemSchema).min(1),
});

/**
 * Every field here is APPLIED by the PATCH route. It previously declared four
 * fields the handler silently discarded, so a caller got 200 OK and no change;
 * whatever this schema accepts must reach the database.
 *
 * What is permitted for a given invoice is a lifecycle question, not a shape
 * question — see checkInvoiceEditScope. Draft invoices take everything; sent
 * invoices take only the fields that carry no economic claim.
 */
export const updateInvoiceSchema = z.object({
  status: z.enum(INVOICE_STATUSES).optional(),
  dueDate: z.string().optional(),
  paymentTerms: z.string().optional(),
  notes: z.string().optional(),
  internalNotes: z.string().optional(),
  accountId: z.string().min(1).optional(),
  contactId: z.string().optional(),
  type: z.enum(INVOICE_TYPES).optional(),
  currency: z.string().length(3).optional(),
  lineItems: z.array(lineItemSchema).min(1).optional(),
});

/** The content half of an invoice update — everything except `status`. */
export const updateInvoiceContentSchema = updateInvoiceSchema.omit({ status: true });

export const recordPaymentSchema = z.object({
  direction: z.enum(PAYMENT_DIRECTIONS),
  method: z.enum(PAYMENT_METHODS),
  amount: z.number().positive(),
  currency: z.string().length(3).default("GBP"),
  reference: z.string().optional(),
  invoiceId: z.string().optional(),
  billId: z.string().optional(),
  notes: z.string().optional(),
  receivedAt: z.string().optional(),
});

// Customer-facing e-signature capture on the payment portal (Phase 1).
export const signInvoiceSchema = z.object({
  token: z.string().min(1),
  signedByName: z.string().trim().min(1).max(200),
  signedByEmail: z.string().trim().email(),
  // Captured signature image (canvas → PNG/JPEG data URL). Capped to bound the payload.
  signatureDataUrl: z
    .string()
    .max(2_000_000)
    .regex(/^data:image\/(png|jpeg);base64,/, "Signature must be a captured image"),
});

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>;
/**
 * z.input, not z.infer: line items carry `.default()` on taxRate and
 * discountPercent, so the OUTPUT type marks them required. Callers legitimately
 * omit them (buildInvoiceTotals applies the same defaults), and parsed output
 * remains assignable to this.
 */
export type UpdateInvoiceContentInput = z.input<typeof updateInvoiceContentSchema>;
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
export type SignInvoiceInput = z.infer<typeof signInvoiceSchema>;
