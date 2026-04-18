import { describe, expect, it } from "vitest";
import { getFinanceFamily, FINANCE_FAMILIES } from "@/components/finance/finance-nav";

describe("finance-nav", () => {
  it("defines the top-level finance workflow families", () => {
    expect(FINANCE_FAMILIES.map((family) => family.label)).toEqual([
      "Overview",
      "Revenue",
      "Spend",
      "Close",
      "Configuration",
    ]);
  });

  it("maps revenue routes to the Revenue family", () => {
    expect(getFinanceFamily("/finance/invoices").key).toBe("revenue");
    expect(getFinanceFamily("/finance/invoices/new").key).toBe("revenue");
    expect(getFinanceFamily("/finance/payments").key).toBe("revenue");
  });

  it("maps spend routes to the Spend family", () => {
    expect(getFinanceFamily("/finance/bills").key).toBe("spend");
    expect(getFinanceFamily("/finance/expense-claims").key).toBe("spend");
    expect(getFinanceFamily("/finance/my-expenses").key).toBe("spend");
    expect(getFinanceFamily("/finance/suppliers").key).toBe("spend");
    expect(getFinanceFamily("/finance/purchase-orders").key).toBe("spend");
  });

  it("maps close routes to the Close family", () => {
    expect(getFinanceFamily("/finance/reports").key).toBe("close");
    expect(getFinanceFamily("/finance/reports/profit-loss").key).toBe("close");
    expect(getFinanceFamily("/finance/recurring").key).toBe("close");
    expect(getFinanceFamily("/finance/assets").key).toBe("close");
    expect(getFinanceFamily("/finance/payment-runs").key).toBe("close");
  });

  it("maps configuration routes to the Configuration family", () => {
    expect(getFinanceFamily("/finance/settings").key).toBe("configuration");
    expect(getFinanceFamily("/finance/settings/currency").key).toBe("configuration");
    expect(getFinanceFamily("/finance/settings/dunning").key).toBe("configuration");
    expect(getFinanceFamily("/finance/banking").key).toBe("configuration");
    expect(getFinanceFamily("/finance/banking/rules").key).toBe("configuration");
  });

  it("keeps the finance root in the Overview family", () => {
    expect(getFinanceFamily("/finance").key).toBe("overview");
  });
});
