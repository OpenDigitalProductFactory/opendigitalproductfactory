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
  invoiceTemplateStyle: "professional" | "trade" | "creative" | "nonprofit" | "minimal";
  expenseCategories: string[];
  purchaseOrdersEnabled: boolean;
  chartOfAccountsSeed: Array<{
    code: string;
    name: string;
    type: "revenue" | "expense" | "asset" | "liability" | "equity";
  }>;
};
