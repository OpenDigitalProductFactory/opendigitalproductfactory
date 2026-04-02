import { describe, expect, it } from "vitest";
import * as Finance from "./index";

describe("finance barrel export", () => {
  it("exports all public symbols", () => {
    expect(Object.keys(Finance).sort()).toMatchSnapshot();
  });

  it("includes key schemas", () => {
    expect(Finance).toHaveProperty("createBankAccountSchema");
    expect(Finance).toHaveProperty("createInvoiceSchema");
    expect(Finance).toHaveProperty("createExpenseClaimSchema");
    expect(Finance).toHaveProperty("createSupplierSchema");
    expect(Finance).toHaveProperty("createAssetSchema");
    expect(Finance).toHaveProperty("createRecurringScheduleSchema");
    expect(Finance).toHaveProperty("getCurrencySymbol");
  });
});
