export type PaymentPattern =
  | "point-of-sale"
  | "appointment-checkout"
  | "ad-hoc-invoice"
  | "recurring-agreement"
  | "subscription"
  | "retainer"
  | "project-milestone"
  | "usage-based"
  | "donation"
  | "optional-package";

export type InvoiceExecutionMode = "none" | "manual" | "prepared-not-prescribed" | "automated";

export type RecurringBillingApplicability = "required" | "recommended" | "optional" | "not-applicable";

export type BillingPatternProfile = {
  primaryPaymentPattern: PaymentPattern;
  supportedPaymentPatterns: PaymentPattern[];
  invoiceExecutionMode: InvoiceExecutionMode;
  recurringBillingApplicability: RecurringBillingApplicability;
};

export type FinancialProfile = {
  archetypeCategory: string;
  displayName: string;
  defaultPaymentTerms: string;
  defaultCurrency: string;
  vatRegistered: boolean;
  defaultTaxRate: number;
  dunningEnabled: boolean;
  dunningStyle: "standard" | "aggressive" | "gentle" | "off";
  recurringBillingEnabled: boolean;
  billingPatternProfile: BillingPatternProfile;
  invoiceTemplateStyle: "professional" | "trade" | "creative" | "nonprofit" | "minimal";
  expenseCategories: string[];
  purchaseOrdersEnabled: boolean;
  chartOfAccountsSeed: Array<{
    code: string;
    name: string;
    type: "revenue" | "expense" | "asset" | "liability" | "equity";
  }>;
};
