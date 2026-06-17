import type { DpfClient } from "../client";
import type {
  CreateInvoiceInput,
  InvoiceDetail,
  PaymentDetail,
  RecordPaymentInput,
} from "@dpf/types";

/**
 * Finance endpoints — invoicing and payment recording. The field tech's
 * "complete a job → bill the customer → take the payment" flow on mobile
 * goes through `invoices.create` then `payments.record` (allocated to the
 * just-created invoice). Same wire shapes the portal uses; the server is
 * authoritative for totals + allocations.
 */
export function financeEndpoints(client: DpfClient) {
  return {
    invoices: {
      /** Draft + persist an invoice; server computes subtotals/tax/total. */
      create: (input: CreateInvoiceInput) =>
        client.post<InvoiceDetail>("/api/v1/finance/invoices", input),

      get: (id: string) =>
        client.get<InvoiceDetail>(
          `/api/v1/finance/invoices/${encodeURIComponent(id)}`,
        ),
    },
    payments: {
      /** Record a payment; allocate to an invoice when `invoiceId` is set. */
      record: (input: RecordPaymentInput) =>
        client.post<PaymentDetail>("/api/v1/finance/payments", input),
    },
  };
}
