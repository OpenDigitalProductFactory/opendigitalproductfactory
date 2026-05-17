import { describe, expect, it } from "vitest";
import { NATIVE_INTEGRATIONS } from "./native-integration-catalog";

describe("native integration catalog readiness metadata", () => {
  it("declares QuickBooks accounting readiness entity families", () => {
    const quickBooks = NATIVE_INTEGRATIONS.find((integration) => integration.id === "quickbooks");

    expect(quickBooks?.readiness?.entityFamilies).toEqual([
      "company",
      "customers",
      "invoices",
      "vendors",
      "bills",
      "payments",
      "accounts",
      "bank_transactions",
      "reports",
      "tax",
      "accountant_workflow",
    ]);
  });
});
