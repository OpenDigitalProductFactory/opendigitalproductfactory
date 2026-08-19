import { describe, expect, it } from "vitest";
import { buildQuickBooksImportReviewBatch } from "./import-review";
import { QUICKBOOKS_IMPORT_STAGING_ENTITY_FAMILIES } from "./import-staging";

describe("QuickBooks import review mapper", () => {
  it("turns all staged QuickBooks core accounting families into read-only review candidates", () => {
    const batch = buildQuickBooksImportReviewBatch({
      batchId: "quickbooks-review-2026-05-22",
      providerEnvironment: "sandbox",
      sourceTimestamp: "2026-05-22T12:00:00.000Z",
      records: {
        company: {
          Id: "company-1",
          CompanyName: "Acme Services LLC",
          Country: "US",
          MetaData: { LastUpdatedTime: "2026-05-22T11:00:00.000Z" },
        },
        customers: [
          {
            Id: "customer-1",
            DisplayName: "Acme Managed IT",
            CompanyName: "Acme Managed IT LLC",
            MetaData: { LastUpdatedTime: "2026-05-22T10:00:00.000Z" },
          },
        ],
        invoices: [
          {
            Id: "invoice-1",
            DocNumber: "INV-1001",
            TotalAmt: 1250,
            Balance: 250,
            CustomerRef: { value: "customer-1", name: "Acme Managed IT" },
            MetaData: { LastUpdatedTime: "2026-05-22T10:15:00.000Z" },
          },
        ],
        vendors: [
          {
            Id: "vendor-1",
            DisplayName: "Acme Supplies",
            PrimaryEmailAddr: { Address: "billing@example.test" },
            MetaData: { LastUpdatedTime: "2026-05-22T10:20:00.000Z" },
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
            MetaData: { LastUpdatedTime: "2026-05-22T10:25:00.000Z" },
          },
        ],
        expenses: [
          {
            Id: "expense-1",
            TotalAmt: 42.75,
            PaymentType: "CreditCard",
            AccountRef: { value: "account-1", name: "Meals" },
            EntityRef: { value: "vendor-1", name: "Acme Supplies", type: "Vendor" },
            MetaData: { LastUpdatedTime: "2026-05-22T10:30:00.000Z" },
          },
        ],
        payments: [
          {
            Id: "payment-1",
            TotalAmt: 1000,
            CustomerRef: { value: "customer-1", name: "Acme Managed IT" },
            MetaData: { LastUpdatedTime: "2026-05-22T10:35:00.000Z" },
          },
        ],
        accounts: [
          {
            Id: "account-1",
            Name: "Checking",
            AccountType: "Bank",
            AccountSubType: "Checking",
            CurrentBalance: 4500,
            MetaData: { LastUpdatedTime: "2026-05-22T10:40:00.000Z" },
          },
        ],
        reports: [
          {
            Header: {
              ReportName: "ProfitAndLoss",
              Time: "2026-05-22T10:45:00.000Z",
              StartPeriod: "2026-05-01",
              EndPeriod: "2026-05-22",
            },
            Rows: { Row: [] },
          },
        ],
      },
    });

    expect(batch.sourceProvider).toBe("quickbooks");
    expect(batch.providerEnvironment).toBe("sandbox");
    expect(batch.records.map((record) => record.entityFamily)).toEqual(
      Array.from(QUICKBOOKS_IMPORT_STAGING_ENTITY_FAMILIES),
    );
    expect(batch.records.every((record) => record.ownerSide === "external")).toBe(true);
    expect(batch.records.every((record) => record.reviewStatus === "candidate")).toBe(true);
    expect(batch.records.every((record) => record.readOnly === true)).toBe(true);
    expect(batch.records.every((record) => record.externalId.length > 0)).toBe(true);
    expect(batch.records.every((record) => /^[a-f0-9]{64}$/.test(record.sourceFingerprint))).toBe(true);
    expect(JSON.stringify(batch)).not.toContain("Rows");
    expect(JSON.stringify(batch)).not.toContain("refreshToken");
  });
});
