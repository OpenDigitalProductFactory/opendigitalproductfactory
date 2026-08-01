import type { BillingPatternProfile, FinancialProfile } from "./types";

export type FinancialProfileSeed = Omit<FinancialProfile, "billingPatternProfile" | "recurringBillingEnabled"> & {
  billingPatternProfile?: BillingPatternProfile;
  recurringBillingEnabled?: boolean;
};

export const POINT_OF_SALE_PATTERN: BillingPatternProfile = {
  primaryPaymentPattern: "point-of-sale",
  supportedPaymentPatterns: ["point-of-sale", "ad-hoc-invoice"],
  invoiceExecutionMode: "manual",
  recurringBillingApplicability: "optional",
};

export const RECURRING_AGREEMENT_PATTERN: BillingPatternProfile = {
  primaryPaymentPattern: "recurring-agreement",
  supportedPaymentPatterns: ["recurring-agreement", "retainer", "project-milestone", "ad-hoc-invoice"],
  invoiceExecutionMode: "prepared-not-prescribed",
  recurringBillingApplicability: "required",
};

export const APPOINTMENT_CHECKOUT_PATTERN: BillingPatternProfile = {
  primaryPaymentPattern: "appointment-checkout",
  supportedPaymentPatterns: ["appointment-checkout", "point-of-sale", "optional-package"],
  invoiceExecutionMode: "manual",
  recurringBillingApplicability: "optional",
};

export const SUBSCRIPTION_PATTERN: BillingPatternProfile = {
  primaryPaymentPattern: "subscription",
  supportedPaymentPatterns: ["subscription", "ad-hoc-invoice"],
  invoiceExecutionMode: "prepared-not-prescribed",
  recurringBillingApplicability: "required",
};

export const DONATION_PATTERN: BillingPatternProfile = {
  primaryPaymentPattern: "donation",
  supportedPaymentPatterns: ["donation", "subscription"],
  invoiceExecutionMode: "manual",
  recurringBillingApplicability: "recommended",
};

export const AD_HOC_INVOICE_PATTERN: BillingPatternProfile = {
  primaryPaymentPattern: "ad-hoc-invoice",
  supportedPaymentPatterns: ["ad-hoc-invoice", "project-milestone"],
  invoiceExecutionMode: "manual",
  recurringBillingApplicability: "optional",
};

// `account-based-fees`: standing client accounts invoiced in arrears from a rate card.
export const RETAINER_PATTERN: BillingPatternProfile = {
  primaryPaymentPattern: "retainer",
  supportedPaymentPatterns: ["retainer", "ad-hoc-invoice"],
  invoiceExecutionMode: "prepared-not-prescribed",
  recurringBillingApplicability: "recommended",
};

export const STATUTORY_FEES_PATTERN: BillingPatternProfile = {
  primaryPaymentPattern: "ad-hoc-invoice",
  supportedPaymentPatterns: ["ad-hoc-invoice", "recurring-agreement"],
  invoiceExecutionMode: "prepared-not-prescribed",
  recurringBillingApplicability: "optional",
};
