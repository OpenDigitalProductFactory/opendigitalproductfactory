import { describe, expect, it } from "vitest";
import {
  QUICKBOOKS_IMPORT_STAGING_ENTITY_FAMILIES,
  buildQuickBooksImportStagingDescriptor,
  stageQuickBooksCoreAccountingRecords,
} from "./import-staging";

describe("QuickBooks import staging", () => {
  it("defines external-owned, read-only staging posture for core accounting families", () => {
    const descriptor = buildQuickBooksImportStagingDescriptor();

    expect(descriptor.schemaVersion).toBe("1.0");
    expect(descriptor.sourceProvider).toBe("quickbooks");
    expect(descriptor.readOnly).toBe(true);
    expect(descriptor.approvalGate).toContain("No QuickBooks writes");
    expect(descriptor.rollbackExpectation).toContain("export");
    expect(descriptor.families.map((family) => family.key)).toEqual([
      "company",
      "customers",
      "invoices",
      "vendors",
      "bills",
      "expenses",
      "payments",
      "accounts",
      "reports",
    ]);
    expect(descriptor.families.map((family) => family.ownerSide)).toEqual(
      QUICKBOOKS_IMPORT_STAGING_ENTITY_FAMILIES.map(() => "external"),
    );
    expect(descriptor.families.find((family) => family.key === "invoices")?.proposedLocalEntity).toBe(
      "Invoice",
    );
    expect(descriptor.families.find((family) => family.key === "accounts")?.proposedLocalEntity).toBe(
      "ChartOfAccount",
    );
  });

  it("projects source-attributed staged records without preserving raw provider payloads", () => {
    const staged = stageQuickBooksCoreAccountingRecords({
      sourceTimestamp: "2026-05-20T12:00:00.000Z",
      company: {
        Id: "company-1",
        CompanyName: "Acme Services LLC",
        Country: "US",
        MetaData: { LastUpdatedTime: "2026-05-20T11:00:00.000Z" },
      },
      customers: [
        {
          Id: "customer-1",
          DisplayName: "Acme Managed IT",
          CompanyName: "Acme Managed IT LLC",
          MetaData: { LastUpdatedTime: "2026-05-20T10:00:00.000Z" },
        },
      ],
      invoices: [
        {
          Id: "invoice-1",
          DocNumber: "INV-1001",
          TotalAmt: 1250,
          Balance: 250,
          CustomerRef: { value: "customer-1", name: "Acme Managed IT" },
          MetaData: { LastUpdatedTime: "2026-05-20T10:15:00.000Z" },
        },
      ],
      vendors: [
        {
          Id: "vendor-1",
          DisplayName: "Acme Supplies",
          PrimaryEmailAddr: { Address: "billing@example.test" },
          MetaData: { LastUpdatedTime: "2026-05-20T10:20:00.000Z" },
        },
      ],
      bills: [
        {
          Id: "bill-1",
          DocNumber: "BILL-1001",
          TotalAmt: 300,
          Balance: 300,
          VendorRef: { value: "vendor-1", name: "Acme Supplies" },
          DueDate: "2026-06-01",
          MetaData: { LastUpdatedTime: "2026-05-20T10:25:00.000Z" },
        },
      ],
      expenses: [
        {
          Id: "expense-1",
          TotalAmt: 42.75,
          PaymentType: "CreditCard",
          AccountRef: { value: "account-1", name: "Meals" },
          EntityRef: { value: "vendor-1", name: "Acme Supplies", type: "Vendor" },
          MetaData: { LastUpdatedTime: "2026-05-20T10:30:00.000Z" },
        },
      ],
      payments: [
        {
          Id: "payment-1",
          TotalAmt: 1000,
          CustomerRef: { value: "customer-1", name: "Acme Managed IT" },
          MetaData: { LastUpdatedTime: "2026-05-20T10:35:00.000Z" },
        },
      ],
      accounts: [
        {
          Id: "account-1",
          Name: "Checking",
          AccountType: "Bank",
          AccountSubType: "Checking",
          CurrentBalance: 4500,
          MetaData: { LastUpdatedTime: "2026-05-20T10:40:00.000Z" },
        },
      ],
      reports: [
        {
          Header: {
            ReportName: "ProfitAndLoss",
            Time: "2026-05-20T10:45:00.000Z",
            StartPeriod: "2026-05-01",
            EndPeriod: "2026-05-20",
          },
          Rows: { Row: [] },
        },
      ],
    });

    expect(staged.map((record) => record.entityFamily)).toEqual([
      "company",
      "customers",
      "invoices",
      "vendors",
      "bills",
      "expenses",
      "payments",
      "accounts",
      "reports",
    ]);
    expect(staged.every((record) => record.sourceProvider === "quickbooks")).toBe(true);
    expect(staged.every((record) => record.readOnly === true)).toBe(true);
    expect(staged.every((record) => record.ownerSide === "external")).toBe(true);
    expect(staged.every((record) => record.externalId.length > 0)).toBe(true);
    expect(staged.every((record) => record.sourceTimestamp)).toBe(true);
    expect(staged.every((record) => record.proposedLocalLink.status === "candidate")).toBe(true);
    expect(staged.every((record) => record.proposedLocalLink.localId === null)).toBe(true);
    expect(staged.every((record) => record.displayFields.length > 0)).toBe(true);
    expect(staged.find((record) => record.entityFamily === "reports")?.externalId).toBe("ProfitAndLoss");
    expect(JSON.stringify(staged)).not.toContain("Rows");
    expect(JSON.stringify(staged)).not.toContain("refreshToken");
  });
});
