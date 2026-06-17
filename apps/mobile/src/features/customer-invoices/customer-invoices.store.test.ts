import {
  selectOpenInvoices,
  useCustomerInvoicesStore,
} from "./customer-invoices.store";
import type { InvoiceDetail } from "@dpf/types";

const mockMyInvoices = jest.fn();

jest.mock("@/src/lib/apiClient", () => ({
  api: {
    customer: {
      myInvoices: (...a: unknown[]) => mockMyInvoices(...a),
    },
  },
}));

const inv = (
  id: string,
  amountDue: number,
  status: InvoiceDetail["status"] = "sent",
  createdAt = "2026-06-10T00:00:00.000Z",
): InvoiceDetail => ({
  id,
  invoiceRef: `INV-${id}`,
  type: "standard",
  status,
  currency: "USD",
  subtotal: 100,
  taxAmount: 0,
  discountAmount: 0,
  totalAmount: amountDue,
  amountPaid: 0,
  amountDue,
  dueDate: "2026-07-10",
  sentAt: null,
  paidAt: null,
  createdAt,
  updatedAt: createdAt,
  account: null,
});

function resetStore() {
  useCustomerInvoicesStore.getState().reset();
  mockMyInvoices.mockReset();
}

describe("useCustomerInvoicesStore.fetch", () => {
  beforeEach(resetStore);

  it("populates `invoices` from the API on success", async () => {
    mockMyInvoices.mockResolvedValueOnce({ data: [inv("1", 100)], nextCursor: null });
    await useCustomerInvoicesStore.getState().fetch();
    expect(useCustomerInvoicesStore.getState().invoices).toHaveLength(1);
    expect(useCustomerInvoicesStore.getState().isLoading).toBe(false);
    expect(useCustomerInvoicesStore.getState().error).toBeNull();
  });

  it("forwards the status filter", async () => {
    mockMyInvoices.mockResolvedValueOnce({ data: [], nextCursor: null });
    await useCustomerInvoicesStore.getState().fetch("sent");
    expect(mockMyInvoices.mock.calls[0][0]).toEqual({ status: "sent", limit: 25 });
  });

  it("surfaces API errors and leaves the previous list alone", async () => {
    useCustomerInvoicesStore.setState({ invoices: [inv("seed", 50)] });
    mockMyInvoices.mockRejectedValueOnce(new Error("HTTP 500"));
    await useCustomerInvoicesStore.getState().fetch();
    const s = useCustomerInvoicesStore.getState();
    expect(s.isLoading).toBe(false);
    expect(s.error).toContain("500");
    expect(s.invoices).toHaveLength(1);
  });
});

describe("selectOpenInvoices", () => {
  it("drops zero-balance invoices", () => {
    expect(selectOpenInvoices([inv("1", 0)])).toHaveLength(0);
  });

  it("drops voided and written_off invoices even with a balance", () => {
    expect(
      selectOpenInvoices([
        inv("v", 100, "void"),
        inv("w", 100, "written_off"),
        inv("ok", 100, "sent"),
      ]),
    ).toHaveLength(1);
  });

  it("orders most-recent-first, then by amountDue desc", () => {
    const out = selectOpenInvoices([
      inv("older", 100, "sent", "2026-05-01T00:00:00.000Z"),
      inv("newer-small", 50, "sent", "2026-06-15T00:00:00.000Z"),
      inv("newer-large", 200, "sent", "2026-06-15T00:00:00.000Z"),
    ]);
    expect(out.map((i) => i.id)).toEqual(["newer-large", "newer-small", "older"]);
  });
});
