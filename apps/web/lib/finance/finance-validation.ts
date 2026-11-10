import { z } from "zod";
import {
  INVOICE_STATUSES,
  INVOICE_TYPES,
  PAYMENT_DIRECTIONS,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  type CreateInvoiceInput,
  type RecordPaymentInput,
} from "@dpf/types";

// The closed sets and the request shapes live once, in @dpf/types (finance.ts),
// shared with the mobile field surface. Re-exported so existing importers of this
// module keep one path (plan 2026-09-08 §10.5 S9).
export { INVOICE_STATUSES, INVOICE_TYPES, PAYMENT_DIRECTIONS, PAYMENT_METHODS, PAYMENT_STATUSES };
export type { CreateInvoiceInput, RecordPaymentInput };

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
  currency: z.string().length(3).optional(), // absent = the org base currency, filled by the writer (BI-6030131C)
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
  currency: z.string().length(3).optional(), // absent = the org base currency, filled by the writer (BI-6030131C)
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

export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>;
/**
 * z.input, not z.infer: line items carry `.default()` on taxRate and
 * discountPercent, so the OUTPUT type marks them required. Callers legitimately
 * omit them (buildInvoiceTotals applies the same defaults), and parsed output
 * remains assignable to this.
 */
export type UpdateInvoiceContentInput = z.input<typeof updateInvoiceContentSchema>;
export type SignInvoiceInput = z.infer<typeof signInvoiceSchema>;

// ─── Wire-contract pins ─────────────────────────────────────────────────────
// The request bodies these schemas accept are declared in @dpf/types. Each pin
// compiles only while the schema's INPUT type and the shared wire type are
// assignable both ways, so a field added, removed or retyped on one side fails
// `pnpm --filter web typecheck`. Same idiom as lib/contracts/entity-contract-drift.ts.
type AssertAssignable<Expected, _Actual extends Expected> = true;

type _CreateInvoiceAccepts = AssertAssignable<CreateInvoiceInput, z.input<typeof createInvoiceSchema>>;
type _CreateInvoiceCovers = AssertAssignable<z.input<typeof createInvoiceSchema>, CreateInvoiceInput>;
type _RecordPaymentAccepts = AssertAssignable<RecordPaymentInput, z.input<typeof recordPaymentSchema>>;
type _RecordPaymentCovers = AssertAssignable<z.input<typeof recordPaymentSchema>, RecordPaymentInput>;

export type FinanceWireContractChecks = [
  _CreateInvoiceAccepts,
  _CreateInvoiceCovers,
  _RecordPaymentAccepts,
  _RecordPaymentCovers,
];
