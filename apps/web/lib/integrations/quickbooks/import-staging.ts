import type {
  IntegrationImportDisplayField,
  IntegrationImportStagingDescriptor,
  IntegrationImportStagingFamily,
  IntegrationImportStagingRecord,
  IntegrationProposedLocalLink,
} from "@/lib/integrations/import-staging";
import type {
  QuickBooksAccount,
  QuickBooksBill,
  QuickBooksCompanyInfo,
  QuickBooksCustomer,
  QuickBooksExpense,
  QuickBooksInvoice,
  QuickBooksPayment,
  QuickBooksReport,
  QuickBooksVendor,
} from "./accounting-client";

export const QUICKBOOKS_IMPORT_STAGING_ENTITY_FAMILIES = [
  "company",
  "customers",
  "invoices",
  "vendors",
  "bills",
  "expenses",
  "payments",
  "accounts",
  "reports",
] as const;

export type QuickBooksImportStagingEntityFamily =
  (typeof QUICKBOOKS_IMPORT_STAGING_ENTITY_FAMILIES)[number];

type QuickBooksStagingFamilyTemplate = IntegrationImportStagingFamily & {
  key: QuickBooksImportStagingEntityFamily;
};

const QUICKBOOKS_STAGING_FAMILIES: QuickBooksStagingFamilyTemplate[] = [
  family("company", "Company profile", "Organization", ["CompanyInfo.Id", "CompanyInfo.MetaData"], [
    "Company name",
    "Country",
  ]),
  family("customers", "Customers", "CustomerAccount", ["Customer.Id", "Customer.MetaData"], [
    "Display name",
    "Company name",
  ]),
  family("invoices", "Invoices", "Invoice", ["Invoice.Id", "Invoice.MetaData"], [
    "Invoice number",
    "Customer",
    "Total",
    "Balance",
  ]),
  family("vendors", "Vendors", "Supplier", ["Vendor.Id", "Vendor.MetaData"], [
    "Display name",
    "Email",
  ]),
  family("bills", "Bills", "Bill", ["Bill.Id", "Bill.MetaData"], [
    "Bill number",
    "Vendor",
    "Total",
    "Balance",
    "Due date",
  ]),
  family("expenses", "Expenses", "ExpenseClaim", ["Purchase.Id", "Purchase.MetaData"], [
    "Payment type",
    "Account",
    "Payee",
    "Total",
  ]),
  family("payments", "Payments", "Payment", ["Payment.Id", "Payment.MetaData"], [
    "Customer",
    "Total",
  ]),
  family("accounts", "Accounts", "ChartOfAccount", ["Account.Id", "Account.MetaData"], [
    "Name",
    "Type",
    "Subtype",
    "Balance",
  ]),
  family("reports", "Reports", "FinanceReportSnapshot", ["Header.ReportName", "Header.Time"], [
    "Report",
    "Period",
    "Generated",
  ]),
];

export type QuickBooksCoreAccountingRecordsInput = {
  sourceTimestamp?: string | null;
  company?: QuickBooksCompanyInfo | null;
  customers?: QuickBooksCustomer[];
  invoices?: QuickBooksInvoice[];
  vendors?: QuickBooksVendor[];
  bills?: QuickBooksBill[];
  expenses?: QuickBooksExpense[];
  payments?: QuickBooksPayment[];
  accounts?: QuickBooksAccount[];
  reports?: QuickBooksReport[];
};

export function buildQuickBooksImportStagingDescriptor(): IntegrationImportStagingDescriptor {
  return {
    schemaVersion: "1.0",
    sourceProvider: "quickbooks",
    readOnly: true,
    approvalGate:
      "No QuickBooks writes, local edits, or DPF-primary promotion until source-attributed staging is reviewed and an approval-gated write path exists.",
    rollbackExpectation:
      "Staged records must remain exportable with provider identifiers before any DPF-primary ownership promotion.",
    families: QUICKBOOKS_STAGING_FAMILIES.map((template) => ({ ...template })),
  };
}

export function stageQuickBooksCoreAccountingRecords({
  sourceTimestamp = null,
  company,
  customers = [],
  invoices = [],
  vendors = [],
  bills = [],
  expenses = [],
  payments = [],
  accounts = [],
  reports = [],
}: QuickBooksCoreAccountingRecordsInput): IntegrationImportStagingRecord[] {
  return [
    company ? stageCompany(company, sourceTimestamp) : null,
    ...customers.map((record) =>
      stageEntity("customers", record.Id, record, sourceTimestamp, [
        displayField("Display name", record.DisplayName),
        displayField("Company name", record.CompanyName),
      ]),
    ),
    ...invoices.map((record) =>
      stageEntity("invoices", record.Id, record, sourceTimestamp, [
        displayField("Invoice number", record.DocNumber),
        displayField("Customer", record.CustomerRef?.name),
        displayField("Total", formatAmount(record.TotalAmt)),
        displayField("Balance", formatAmount(record.Balance)),
      ]),
    ),
    ...vendors.map((record) =>
      stageEntity("vendors", record.Id, record, sourceTimestamp, [
        displayField("Display name", record.DisplayName ?? record.CompanyName),
        displayField("Email", record.PrimaryEmailAddr?.Address),
      ]),
    ),
    ...bills.map((record) =>
      stageEntity("bills", record.Id, record, sourceTimestamp, [
        displayField("Bill number", record.DocNumber),
        displayField("Vendor", record.VendorRef?.name),
        displayField("Total", formatAmount(record.TotalAmt)),
        displayField("Balance", formatAmount(record.Balance)),
        displayField("Due date", record.DueDate),
      ]),
    ),
    ...expenses.map((record) =>
      stageEntity("expenses", record.Id, record, sourceTimestamp, [
        displayField("Payment type", record.PaymentType),
        displayField("Account", record.AccountRef?.name),
        displayField("Payee", record.EntityRef?.name),
        displayField("Total", formatAmount(record.TotalAmt)),
      ]),
    ),
    ...payments.map((record) =>
      stageEntity("payments", record.Id, record, sourceTimestamp, [
        displayField("Customer", record.CustomerRef?.name),
        displayField("Total", formatAmount(record.TotalAmt)),
      ]),
    ),
    ...accounts.map((record) =>
      stageEntity("accounts", record.Id, record, sourceTimestamp, [
        displayField("Name", record.Name),
        displayField("Type", record.AccountType),
        displayField("Subtype", record.AccountSubType),
        displayField("Balance", formatAmount(record.CurrentBalance)),
      ]),
    ),
    ...reports.map((record) => stageReport(record, sourceTimestamp)),
  ].filter((record): record is IntegrationImportStagingRecord => Boolean(record));
}

function family(
  key: QuickBooksImportStagingEntityFamily,
  label: string,
  proposedLocalEntity: string,
  providerSpecificFields: readonly string[],
  reviewFields: readonly string[],
): QuickBooksStagingFamilyTemplate {
  return {
    key,
    label,
    ownerSide: "external",
    proposedLocalEntity,
    requiredSourceFields: [
      "externalId",
      "sourceProvider",
      "sourceTimestamp",
      "ownerSide",
      "proposedLocalLink",
      ...providerSpecificFields,
    ],
    reviewFields,
  };
}

function stageCompany(
  record: QuickBooksCompanyInfo,
  fallbackTimestamp: string | null,
): IntegrationImportStagingRecord | null {
  return stageEntity("company", record.Id ?? record.CompanyName, record, fallbackTimestamp, [
    displayField("Company name", record.CompanyName),
    displayField("Country", record.Country),
  ]);
}

function stageReport(
  record: QuickBooksReport,
  fallbackTimestamp: string | null,
): IntegrationImportStagingRecord | null {
  const externalId = record.Header?.ReportName;
  return stageEntity(
    "reports",
    externalId,
    { MetaData: { LastUpdatedTime: record.Header?.Time } },
    fallbackTimestamp,
    [
      displayField("Report", record.Header?.ReportName),
      displayField("Period", formatPeriod(record.Header?.StartPeriod, record.Header?.EndPeriod)),
      displayField("Generated", record.Header?.Time),
    ],
  );
}

function stageEntity(
  familyKey: QuickBooksImportStagingEntityFamily,
  externalId: string | undefined,
  sourceRecord: { MetaData?: { LastUpdatedTime?: string; CreateTime?: string } },
  fallbackTimestamp: string | null,
  displayFields: Array<IntegrationImportDisplayField | null>,
): IntegrationImportStagingRecord | null {
  if (!externalId) {
    return null;
  }

  const familyTemplate = QUICKBOOKS_STAGING_FAMILIES.find((template) => template.key === familyKey);
  if (!familyTemplate) {
    return null;
  }

  return {
    entityFamily: familyKey,
    externalId,
    sourceProvider: "quickbooks",
    sourceTimestamp: resolveSourceTimestamp(sourceRecord, fallbackTimestamp),
    ownerSide: "external",
    proposedLocalLink: proposedLocalLink(familyTemplate),
    displayFields: displayFields.filter((field): field is IntegrationImportDisplayField => Boolean(field)),
    readOnly: true,
  };
}

function resolveSourceTimestamp(
  sourceRecord: { MetaData?: { LastUpdatedTime?: string; CreateTime?: string } },
  fallbackTimestamp: string | null,
): string | null {
  return sourceRecord.MetaData?.LastUpdatedTime ?? sourceRecord.MetaData?.CreateTime ?? fallbackTimestamp;
}

function proposedLocalLink(template: QuickBooksStagingFamilyTemplate): IntegrationProposedLocalLink {
  return {
    entityType: template.proposedLocalEntity,
    localId: null,
    status: "candidate",
    confidence: "low",
    reason: "Review source-attributed QuickBooks record before creating or linking a local DPF record.",
  };
}

function displayField(label: string, value: string | number | null | undefined): IntegrationImportDisplayField | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return {
    label,
    value: String(value),
  };
}

function formatAmount(value: number | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return value.toFixed(2);
}

function formatPeriod(start: string | undefined, end: string | undefined): string | null {
  if (start && end) {
    return `${start} to ${end}`;
  }

  return start ?? end ?? null;
}
