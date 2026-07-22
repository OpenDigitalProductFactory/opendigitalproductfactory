import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/ap", () => ({ createPaymentRun: vi.fn(async () => undefined) }));

import { PaymentRunBuilder } from "./PaymentRunBuilder";

const BILLS = [
  {
    id: "bill-1",
    billRef: "BILL-001",
    supplierId: "sup-1",
    supplierName: "Fresh Produce Co",
    currency: "GBP",
    amountDue: 320,
  },
];

describe("PaymentRunBuilder — payment semantics disclosure", () => {
  it("states it records bills as paid and does NOT initiate a real payment, before any bill is selected", () => {
    const html = renderToStaticMarkup(<PaymentRunBuilder approvedBills={BILLS} />);

    expect(html).toContain("This records bills as paid — it does not move money");
    expect(html).toContain("not initiate a real bank transfer");
    expect(html).toContain("not a draft");
  });

  it("labels the primary action honestly (Record as Paid, not Execute/Pay)", () => {
    const html = renderToStaticMarkup(<PaymentRunBuilder approvedBills={BILLS} />);
    expect(html).not.toContain("Execute Payment Run");
  });

  it("shows the disclosure even when there are no approved bills", () => {
    const html = renderToStaticMarkup(<PaymentRunBuilder approvedBills={[]} />);
    expect(html).toContain("does not move money");
    expect(html).toContain("No approved bills ready to record as paid.");
  });
});
