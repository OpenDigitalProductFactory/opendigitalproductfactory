import {
  __resetLineItemKeyCounterForTests,
  computeDraftTotal,
  newLineItem,
  useInvoicesStore,
} from "./invoices.store";
import type { InvoiceDetail, PaymentDetail } from "@dpf/types";

const mockCreateInvoice = jest.fn();
const mockRecordPayment = jest.fn();

jest.mock("@/src/lib/apiClient", () => ({
  api: {
    finance: {
      invoices: { create: (...a: unknown[]) => mockCreateInvoice(...a) },
      payments: { record: (...a: unknown[]) => mockRecordPayment(...a) },
    },
  },
}));

const SERVER_INVOICE: InvoiceDetail = {
  id: "INV-1",
  invoiceRef: "INV-0001",
  type: "standard",
  status: "draft",
  currency: "USD",
  subtotal: 250,
  taxAmount: 25,
  discountAmount: 0,
  totalAmount: 275,
  amountPaid: 0,
  amountDue: 275,
  dueDate: "2026-07-16",
  sentAt: null,
  paidAt: null,
  createdAt: "2026-06-16T22:00:00.000Z",
  updatedAt: "2026-06-16T22:00:00.000Z",
  account: { id: "ACC-1", name: "Acme HVAC Co" },
};

const SERVER_PAYMENT: PaymentDetail = {
  id: "PMT-1",
  paymentRef: "PMT-0001",
  direction: "inbound",
  method: "cash",
  status: "completed",
  amount: 275,
  currency: "USD",
  reference: null,
  notes: null,
  receivedAt: "2026-06-16T22:30:00.000Z",
  createdAt: "2026-06-16T22:30:00.000Z",
  updatedAt: "2026-06-16T22:30:00.000Z",
};

function resetStore() {
  useInvoicesStore.getState().reset();
  __resetLineItemKeyCounterForTests();
  mockCreateInvoice.mockReset();
  mockRecordPayment.mockReset();
}

describe("computeDraftTotal", () => {
  it("sums quantity * unitPrice with no tax/discount", () => {
    expect(
      computeDraftTotal([
        { key: "a", description: "labor", quantity: 2, unitPrice: 100 },
        { key: "b", description: "part", quantity: 1, unitPrice: 50 },
      ]),
    ).toBe(250);
  });

  it("applies discountPercent before tax", () => {
    // 100 * (1 - 0.10) * (1 + 0.10) = 99
    expect(
      computeDraftTotal([
        {
          key: "a",
          description: "service",
          quantity: 1,
          unitPrice: 100,
          discountPercent: 10,
          taxRate: 10,
        },
      ]),
    ).toBe(99);
  });

  it("rounds to two decimals", () => {
    // 33.33 * 3 = 99.99, exact — but mix tax to force rounding
    expect(
      computeDraftTotal([
        { key: "a", description: "x", quantity: 3, unitPrice: 33.33, taxRate: 7.5 },
      ]),
    ).toBe(107.49);
  });
});

describe("useInvoicesStore — draft + create", () => {
  beforeEach(resetStore);

  it("beginDraft seeds lines and a +30-day due date", () => {
    useInvoicesStore.getState().beginDraft({
      workItemId: "WI-1",
      accountId: "ACC-1",
      seedLines: [{ description: "Service call", quantity: 1, unitPrice: 100 }],
    });
    const s = useInvoicesStore.getState();
    expect(s.workItemId).toBe("WI-1");
    expect(s.accountId).toBe("ACC-1");
    expect(s.lineItems).toHaveLength(1);
    expect(s.lineItems[0].description).toBe("Service call");
    expect(s.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("update and remove line items", () => {
    const store = useInvoicesStore.getState();
    store.beginDraft({ workItemId: "WI-1", seedLines: [{}, {}] });
    const [a, b] = useInvoicesStore.getState().lineItems;
    store.updateLineItem(a.key, { description: "labor", unitPrice: 100, quantity: 2 });
    store.removeLineItem(b.key);
    const after = useInvoicesStore.getState();
    expect(after.lineItems).toHaveLength(1);
    expect(after.lineItems[0].description).toBe("labor");
    expect(after.draftTotal()).toBe(200);
  });

  it("createInvoice refuses an empty accountId", async () => {
    useInvoicesStore.getState().beginDraft({ workItemId: "WI-1" });
    useInvoicesStore.getState().updateLineItem(
      useInvoicesStore.getState().lineItems[0].key,
      { description: "x", quantity: 1, unitPrice: 50 },
    );
    const result = await useInvoicesStore.getState().createInvoice();
    expect(result).toBeNull();
    expect(useInvoicesStore.getState().error).toMatch(/account id/i);
    expect(mockCreateInvoice).not.toHaveBeenCalled();
  });

  it("createInvoice posts the wire shape, drops `key`, and tags the source as the work item", async () => {
    mockCreateInvoice.mockResolvedValueOnce(SERVER_INVOICE);
    const store = useInvoicesStore.getState();
    store.beginDraft({
      workItemId: "WI-1",
      accountId: "ACC-1",
      seedLines: [
        { description: "Labor", quantity: 2, unitPrice: 100, taxRate: 10 },
      ],
    });
    const invoice = await useInvoicesStore.getState().createInvoice();
    expect(invoice).toEqual(SERVER_INVOICE);

    const call = mockCreateInvoice.mock.calls[0][0];
    expect(call.accountId).toBe("ACC-1");
    expect(call.sourceType).toBe("work-item");
    expect(call.sourceId).toBe("WI-1");
    expect(call.lineItems).toHaveLength(1);
    // The React-only `key` must not appear on the wire — every key in the
    // line item is exactly one of the InvoiceLineItemInput fields.
    expect(Object.keys(call.lineItems[0]).includes("key")).toBe(false);
    expect(useInvoicesStore.getState().invoice).toEqual(SERVER_INVOICE);
  });

  it("createInvoice surfaces server failure as state.error and returns null", async () => {
    mockCreateInvoice.mockRejectedValueOnce(new Error("HTTP 422 invalid"));
    useInvoicesStore
      .getState()
      .beginDraft({
        workItemId: "WI-1",
        accountId: "ACC-1",
        seedLines: [{ description: "x", quantity: 1, unitPrice: 10 }],
      });
    const result = await useInvoicesStore.getState().createInvoice();
    expect(result).toBeNull();
    expect(useInvoicesStore.getState().error).toContain("422");
    expect(useInvoicesStore.getState().invoice).toBeNull();
  });
});

describe("useInvoicesStore — recordPayment", () => {
  beforeEach(resetStore);

  it("refuses payment when no invoice has been created", async () => {
    const result = await useInvoicesStore.getState().recordPayment({
      method: "cash",
    });
    expect(result).toBeNull();
    expect(mockRecordPayment).not.toHaveBeenCalled();
  });

  it("records cash payment defaulting to the invoice's amountDue, allocated to the invoice", async () => {
    mockCreateInvoice.mockResolvedValueOnce(SERVER_INVOICE);
    mockRecordPayment.mockResolvedValueOnce(SERVER_PAYMENT);

    useInvoicesStore.getState().beginDraft({
      workItemId: "WI-1",
      accountId: "ACC-1",
      seedLines: [{ description: "Service", quantity: 1, unitPrice: 250, taxRate: 10 }],
    });
    await useInvoicesStore.getState().createInvoice();

    const payment = await useInvoicesStore
      .getState()
      .recordPayment({ method: "cash" });
    expect(payment).toEqual(SERVER_PAYMENT);

    const call = mockRecordPayment.mock.calls[0][0];
    expect(call.direction).toBe("inbound");
    expect(call.method).toBe("cash");
    expect(call.amount).toBe(SERVER_INVOICE.amountDue);
    expect(call.invoiceId).toBe(SERVER_INVOICE.id);
    expect(call.currency).toBe(SERVER_INVOICE.currency);
  });

  it("honors an explicit partial payment amount", async () => {
    mockCreateInvoice.mockResolvedValueOnce(SERVER_INVOICE);
    mockRecordPayment.mockResolvedValueOnce(SERVER_PAYMENT);

    useInvoicesStore.getState().beginDraft({
      workItemId: "WI-1",
      accountId: "ACC-1",
      seedLines: [{ description: "Service", quantity: 1, unitPrice: 250 }],
    });
    await useInvoicesStore.getState().createInvoice();

    await useInvoicesStore
      .getState()
      .recordPayment({ method: "cheque", amount: 100, reference: "#1041" });

    const call = mockRecordPayment.mock.calls[0][0];
    expect(call.amount).toBe(100);
    expect(call.method).toBe("cheque");
    expect(call.reference).toBe("#1041");
  });
});

describe("newLineItem", () => {
  beforeEach(resetStore);

  it("defaults quantity=1, unitPrice=0, and assigns stable keys per call", () => {
    const a = newLineItem();
    const b = newLineItem({ description: "labor", unitPrice: 100 });
    expect(a.quantity).toBe(1);
    expect(a.unitPrice).toBe(0);
    expect(b.description).toBe("labor");
    expect(b.unitPrice).toBe(100);
    expect(a.key).not.toBe(b.key);
  });
});
