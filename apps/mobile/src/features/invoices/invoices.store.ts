import { create } from "zustand";
import type {
  CreateInvoiceInput,
  InvoiceDetail,
  InvoiceLineItemInput,
  PaymentMethod,
  PaymentDetail,
} from "@dpf/types";
import { api } from "@/src/lib/apiClient";

/**
 * Field-tech invoicing + payment store — the post-completion half of the
 * "complete a job → bill the customer → take the payment" flow surfaced
 * from the Job Detail screen. Mirrors the server contract one-for-one
 * (apps/web/lib/finance/finance-validation.ts) via the shared @dpf/types
 * wire shapes; the server is authoritative for totals and allocations.
 *
 * The store holds three things: the editable draft (line items + customer +
 * due date), the just-created `invoice`, and the just-recorded `payment`.
 * Both `createInvoice` and `recordPayment` return the server object so the
 * caller can navigate on success without re-reading the store.
 */

export type DraftLineItem = InvoiceLineItemInput & { key: string };

export interface NewLineItemSeed {
  description?: string;
  quantity?: number;
  unitPrice?: number;
  taxRate?: number;
}

export function newLineItem(seed: NewLineItemSeed = {}): DraftLineItem {
  return {
    // The key only exists to make React lists stable across edits; the server
    // never sees it. Seeded from a monotonic counter so tests are deterministic.
    key: `li-${nextKey()}`,
    description: seed.description ?? "",
    quantity: seed.quantity ?? 1,
    unitPrice: seed.unitPrice ?? 0,
    taxRate: seed.taxRate,
  };
}

let keyCounter = 0;
function nextKey(): number {
  keyCounter += 1;
  return keyCounter;
}
/** Test-only: reset the line-item key sequence so snapshots stay stable. */
export function __resetLineItemKeyCounterForTests(): void {
  keyCounter = 0;
}

/** Sum line totals locally so the tech sees a running figure before submit;
 *  the server recomputes authoritatively and may differ once tax/discount
 *  rounding is applied. */
export function computeDraftTotal(items: DraftLineItem[]): number {
  let total = 0;
  for (const li of items) {
    const lineGross = li.quantity * li.unitPrice;
    const discount = (li.discountPercent ?? 0) / 100;
    const afterDiscount = lineGross * (1 - discount);
    const tax = (li.taxRate ?? 0) / 100;
    total += afterDiscount * (1 + tax);
  }
  return Math.round(total * 100) / 100;
}

interface InvoicesState {
  /** Editable draft. */
  workItemId: string | null;
  accountId: string;
  dueDate: string; // ISO date
  currency: string;
  notes: string;
  lineItems: DraftLineItem[];
  /** Server result of the most recent create — drives the payment screen. */
  invoice: InvoiceDetail | null;
  payment: PaymentDetail | null;
  isSubmitting: boolean;
  error: string | null;

  beginDraft: (input: {
    workItemId: string;
    accountId?: string;
    seedLines?: NewLineItemSeed[];
  }) => void;
  setAccountId: (id: string) => void;
  setDueDate: (iso: string) => void;
  setNotes: (notes: string) => void;
  addLineItem: (seed?: NewLineItemSeed) => void;
  updateLineItem: (key: string, patch: Partial<InvoiceLineItemInput>) => void;
  removeLineItem: (key: string) => void;
  draftTotal: () => number;
  createInvoice: () => Promise<InvoiceDetail | null>;
  recordPayment: (input: {
    method: PaymentMethod;
    amount?: number;
    reference?: string;
    notes?: string;
  }) => Promise<PaymentDetail | null>;
  reset: () => void;
}

const TODAY_PLUS_30 = (): string => {
  // Default due date = +30 days, ISO yyyy-mm-dd. Tech can override on the screen.
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
};

const EMPTY = {
  workItemId: null,
  accountId: "",
  dueDate: "",
  currency: "USD",
  notes: "",
  lineItems: [] as DraftLineItem[],
  invoice: null as InvoiceDetail | null,
  payment: null as PaymentDetail | null,
  isSubmitting: false,
  error: null as string | null,
};

function toCreateInput(state: InvoicesState): CreateInvoiceInput {
  // Drop the React-only `key` before the wire call.
  const lineItems: InvoiceLineItemInput[] = state.lineItems.map(
    ({ key: _key, ...wire }) => wire,
  );
  const input: CreateInvoiceInput = {
    accountId: state.accountId.trim(),
    dueDate: state.dueDate,
    currency: state.currency,
    lineItems,
    sourceType: state.workItemId ? "work-item" : undefined,
    sourceId: state.workItemId ?? undefined,
  };
  if (state.notes.trim().length > 0) input.notes = state.notes.trim();
  return input;
}

export const useInvoicesStore = create<InvoicesState>((set, get) => ({
  ...EMPTY,

  beginDraft: ({ workItemId, accountId, seedLines }) => {
    const lines = (seedLines && seedLines.length > 0 ? seedLines : [{}]).map(
      (s) => newLineItem(s),
    );
    set({
      ...EMPTY,
      workItemId,
      accountId: accountId ?? "",
      dueDate: TODAY_PLUS_30(),
      lineItems: lines,
    });
  },

  setAccountId: (id) => set({ accountId: id }),
  setDueDate: (iso) => set({ dueDate: iso }),
  setNotes: (notes) => set({ notes }),

  addLineItem: (seed) =>
    set((s) => ({ lineItems: [...s.lineItems, newLineItem(seed)] })),

  updateLineItem: (key, patch) =>
    set((s) => ({
      lineItems: s.lineItems.map((li) =>
        li.key === key ? { ...li, ...patch } : li,
      ),
    })),

  removeLineItem: (key) =>
    set((s) => ({ lineItems: s.lineItems.filter((li) => li.key !== key) })),

  draftTotal: () => computeDraftTotal(get().lineItems),

  createInvoice: async () => {
    const state = get();
    if (!state.accountId.trim()) {
      set({ error: "Customer account id is required" });
      return null;
    }
    if (state.lineItems.length === 0) {
      set({ error: "Add at least one line item" });
      return null;
    }
    set({ isSubmitting: true, error: null });
    try {
      const invoice = await api.finance.invoices.create(toCreateInput(state));
      set({ invoice, isSubmitting: false });
      return invoice;
    } catch (err) {
      set({
        isSubmitting: false,
        error: err instanceof Error ? err.message : "Failed to create invoice",
      });
      return null;
    }
  },

  recordPayment: async ({ method, amount, reference, notes }) => {
    const state = get();
    if (!state.invoice) {
      set({ error: "Create the invoice before recording payment" });
      return null;
    }
    const owed = state.invoice.amountDue || state.invoice.totalAmount;
    set({ isSubmitting: true, error: null });
    try {
      const payment = await api.finance.payments.record({
        direction: "inbound",
        method,
        amount: amount ?? owed,
        currency: state.invoice.currency,
        invoiceId: state.invoice.id,
        reference,
        notes,
      });
      set({ payment, isSubmitting: false });
      return payment;
    } catch (err) {
      set({
        isSubmitting: false,
        error: err instanceof Error ? err.message : "Failed to record payment",
      });
      return null;
    }
  },

  reset: () => set({ ...EMPTY }),
}));
