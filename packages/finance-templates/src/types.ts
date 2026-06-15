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

/**
 * The accounting shape the archetype's finance surfaces render.
 * - `commercial` — default; every pre-existing profile.
 * - `fund-accounting` — GASB-style funds with budget-to-actual as the primary statement (public bodies).
 * - `financial-institution` — interest-margin P&L shape; the core banking system stays authoritative.
 * - `cooperative-equity` — commercial P&L plus patronage allocation and allocated/unallocated member equity.
 * See docs/superpowers/specs/2026-06-09-civic-and-member-governed-archetypes-design.md §6.2.
 */
export type LedgerModel =
  | "commercial"
  | "fund-accounting"
  | "financial-institution"
  | "cooperative-equity";

export type FinancialProfile = {
  archetypeCategory: string;
  displayName: string;
  /** Absent ⇒ "commercial"; normalization always resolves it. */
  ledgerModel?: LedgerModel;
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
