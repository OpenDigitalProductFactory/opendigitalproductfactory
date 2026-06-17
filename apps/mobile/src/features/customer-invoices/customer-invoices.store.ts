import { create } from "zustand";
import type { InvoiceDetail } from "@dpf/types";
import { api } from "@/src/lib/apiClient";

/**
 * Customer-side "My invoices" store — backs the customer-mode home panel
 * with the signed-in customer's own invoices (scoped server-side via
 * /api/v1/customer/invoices + requireCustomerAuth). The mobile binary stays
 * generic; the install + persona drive whether this panel renders at all.
 */
interface CustomerInvoicesState {
  invoices: InvoiceDetail[];
  isLoading: boolean;
  error: string | null;
  fetch: (status?: string) => Promise<void>;
  reset: () => void;
}

export const useCustomerInvoicesStore = create<CustomerInvoicesState>((set) => ({
  invoices: [],
  isLoading: false,
  error: null,

  fetch: async (status) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.customer.myInvoices({ status, limit: 25 });
      set({ invoices: res.data, isLoading: false });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : "Failed to load invoices",
      });
    }
  },

  reset: () => set({ invoices: [], isLoading: false, error: null }),
}));

/**
 * Pure projection: pick out only the invoices that still owe money — what
 * the customer cares about on the home tile. Stable order: most-recently
 * created first (server order), then by amountDue desc as a tiebreaker.
 */
export function selectOpenInvoices(all: InvoiceDetail[]): InvoiceDetail[] {
  return [...all]
    .filter((inv) => inv.amountDue > 0 && inv.status !== "void" && inv.status !== "written_off")
    .sort((a, b) => {
      if (a.createdAt !== b.createdAt) {
        return a.createdAt < b.createdAt ? 1 : -1;
      }
      return b.amountDue - a.amountDue;
    });
}
