// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { recordBillPayment, refresh } = vi.hoisted(() => ({
  recordBillPayment: vi.fn(async () => undefined),
  refresh: vi.fn(),
}));

vi.mock("@/lib/actions/ap", () => ({ recordBillPayment }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { RecordBillPaymentButton } from "./RecordBillPaymentButton";

afterEach(() => {
  cleanup();
  recordBillPayment.mockClear();
  refresh.mockClear();
});

describe("RecordBillPaymentButton", () => {
  it("opens a payment form prefilled with the amount due and records an outbound bill payment", async () => {
    render(<RecordBillPaymentButton billId="bill-1" amountDue={85} currency="USD" />);

    fireEvent.click(screen.getByText("Record Payment"));

    // The amount field is the only number input (role spinbutton); the label is
    // visual-only so query by role rather than label association.
    const amount = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(amount.value).toBe("85");

    fireEvent.click(screen.getByText("Confirm payment"));

    await waitFor(() => {
      expect(recordBillPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          billId: "bill-1",
          amount: 85,
          method: "bank_transfer",
        }),
      );
    });
    expect(refresh).toHaveBeenCalled();
  });
});
