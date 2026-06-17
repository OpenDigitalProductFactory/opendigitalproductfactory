/**
 * Finance wire types — shared by the portal producer (apps/web/lib/finance,
 * apps/web/app/api/v1/finance/*) and the mobile field surface
 * (apps/mobile/src/features/invoices). Projection of the Invoice + Payment
 * + InvoiceLineItem + PaymentAllocation models.
 *
 * Mirror the request shapes of finance-validation.ts 1:1 so the mobile call
 * and the server schema cannot drift.
 */

export const INVOICE_TYPES = [
  "standard",
  "credit_note",
  "proforma",
  "recurring_instance",
] as const;
export type InvoiceType = (typeof INVOICE_TYPES)[number];

export const INVOICE_STATUSES = [
  "draft",
  "approved",
  "sent",
  "viewed",
  "partially_paid",
  "paid",
  "overdue",
  "void",
  "written_off",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PAYMENT_DIRECTIONS = ["inbound", "outbound"] as const;
export type PaymentDirection = (typeof PAYMENT_DIRECTIONS)[number];

export const PAYMENT_METHODS = [
  "bank_transfer",
  "card",
  "cash",
  "cheque",
  "direct_debit",
  "stripe",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = [
  "pending",
  "completed",
  "failed",
  "refunded",
  "cancelled",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** A single billable row on a draft invoice. */
export interface InvoiceLineItemInput {
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate?: number;
  discountPercent?: number;
  accountCode?: string;
}

/** Create-invoice request body (POST /api/v1/finance/invoices). */
export interface CreateInvoiceInput {
  accountId: string;
  contactId?: string;
  type?: InvoiceType;
  /** ISO date string. */
  dueDate: string;
  /** ISO 4217 alphabetic code. */
  currency?: string;
  paymentTerms?: string;
  notes?: string;
  internalNotes?: string;
  /** Origin reference, e.g. `sourceType: "work-item", sourceId: itemId`. */
  sourceType?: string;
  sourceId?: string;
  signatureRequired?: boolean;
  lineItems: InvoiceLineItemInput[];
}

/** Detail row returned by the API after create / get. Monetary values are
 *  serialized as numbers; the server is the source of truth for totals. */
export interface InvoiceDetail {
  id: string;
  invoiceRef: string;
  type: InvoiceType;
  status: InvoiceStatus;
  currency: string;
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  totalAmount: number;
  amountPaid: number;
  amountDue: number;
  dueDate: string | null;
  sentAt: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
  account?: { id: string; name: string } | null;
}

/** Record-payment request body (POST /api/v1/finance/payments). */
export interface RecordPaymentInput {
  direction: PaymentDirection;
  method: PaymentMethod;
  amount: number;
  currency?: string;
  reference?: string;
  /** Invoice this payment should be allocated against. */
  invoiceId?: string;
  billId?: string;
  notes?: string;
  /** ISO date-time string; defaults to now() server-side. */
  receivedAt?: string;
}

export interface PaymentDetail {
  id: string;
  paymentRef: string;
  direction: PaymentDirection;
  method: PaymentMethod;
  status: PaymentStatus;
  amount: number;
  currency: string;
  reference: string | null;
  notes: string | null;
  receivedAt: string;
  createdAt: string;
  updatedAt: string;
  allocations?: Array<{
    invoice?: { id: string; invoiceRef: string } | null;
  }>;
}
