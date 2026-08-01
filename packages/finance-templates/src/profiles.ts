import type { BillingPatternProfile, FinancialProfile, LedgerModel } from "./types";

// ─── Profile catalog ──────────────────────────────────────────────────────────

type FinancialProfileSeed = Omit<FinancialProfile, "billingPatternProfile" | "recurringBillingEnabled"> & {
  billingPatternProfile?: BillingPatternProfile;
  recurringBillingEnabled?: boolean;
};

const POINT_OF_SALE_PATTERN: BillingPatternProfile = {
  primaryPaymentPattern: "point-of-sale",
  supportedPaymentPatterns: ["point-of-sale", "ad-hoc-invoice"],
  invoiceExecutionMode: "manual",
  recurringBillingApplicability: "optional",
};

const RECURRING_AGREEMENT_PATTERN: BillingPatternProfile = {
  primaryPaymentPattern: "recurring-agreement",
  supportedPaymentPatterns: ["recurring-agreement", "retainer", "project-milestone", "ad-hoc-invoice"],
  invoiceExecutionMode: "prepared-not-prescribed",
  recurringBillingApplicability: "required",
};

const APPOINTMENT_CHECKOUT_PATTERN: BillingPatternProfile = {
  primaryPaymentPattern: "appointment-checkout",
  supportedPaymentPatterns: ["appointment-checkout", "point-of-sale", "optional-package"],
  invoiceExecutionMode: "manual",
  recurringBillingApplicability: "optional",
};

const SUBSCRIPTION_PATTERN: BillingPatternProfile = {
  primaryPaymentPattern: "subscription",
  supportedPaymentPatterns: ["subscription", "ad-hoc-invoice"],
  invoiceExecutionMode: "prepared-not-prescribed",
  recurringBillingApplicability: "required",
};

const DONATION_PATTERN: BillingPatternProfile = {
  primaryPaymentPattern: "donation",
  supportedPaymentPatterns: ["donation", "subscription"],
  invoiceExecutionMode: "manual",
  recurringBillingApplicability: "recommended",
};

const AD_HOC_INVOICE_PATTERN: BillingPatternProfile = {
  primaryPaymentPattern: "ad-hoc-invoice",
  supportedPaymentPatterns: ["ad-hoc-invoice", "project-milestone"],
  invoiceExecutionMode: "manual",
  recurringBillingApplicability: "optional",
};

// Matches what `deriveBillingPatternProfile` produces for the
// `account-based-fees` commercial model — a standing client account invoiced in
// arrears off a rate card, rather than a charge taken at the point of work.
const RETAINER_PATTERN: BillingPatternProfile = {
  primaryPaymentPattern: "retainer",
  supportedPaymentPatterns: ["retainer", "ad-hoc-invoice"],
  invoiceExecutionMode: "prepared-not-prescribed",
  recurringBillingApplicability: "recommended",
};

const STATUTORY_FEES_PATTERN: BillingPatternProfile = {
  primaryPaymentPattern: "ad-hoc-invoice",
  supportedPaymentPatterns: ["ad-hoc-invoice", "recurring-agreement"],
  invoiceExecutionMode: "prepared-not-prescribed",
  recurringBillingApplicability: "optional",
};

// ─── Ledger-model chart-of-accounts fragments ─────────────────────────────────
// Named template fragments consumed by archetype financial profiles that declare
// a non-commercial ledgerModel (civic archetypes spec §6.2). They are seeds for
// the management view; the org's core/accounting system stays authoritative.
// Defined before PROFILES so profile seeds can compose them.

type ChartOfAccountsSeed = FinancialProfile["chartOfAccountsSeed"];

const LEDGER_FRAGMENTS_INTERNAL: Record<Exclude<LedgerModel, "commercial">, ChartOfAccountsSeed> = {
  "fund-accounting": [
    { code: "1000", name: "General Fund Cash", type: "asset" },
    { code: "3000", name: "Fund Balance — Unassigned", type: "equity" },
    { code: "3010", name: "Fund Balance — Restricted", type: "equity" },
    { code: "4000", name: "Property Tax & Levy Revenue", type: "revenue" },
    { code: "4010", name: "Intergovernmental Revenue & Grants", type: "revenue" },
    { code: "4020", name: "Charges for Services", type: "revenue" },
    { code: "4030", name: "Fines, Fees & Permits", type: "revenue" },
    { code: "4100", name: "Special Revenue Fund Revenue", type: "revenue" },
    { code: "4200", name: "Enterprise Fund Charges", type: "revenue" },
    { code: "5000", name: "General Government Expenditures", type: "expense" },
    { code: "5010", name: "Public Safety Expenditures", type: "expense" },
    { code: "5020", name: "Public Works Expenditures", type: "expense" },
    { code: "5030", name: "Culture & Recreation Expenditures", type: "expense" },
    { code: "5100", name: "Capital Outlay", type: "expense" },
    { code: "5200", name: "Debt Service — Principal & Interest", type: "expense" },
  ],
  "financial-institution": [
    { code: "1000", name: "Loans Receivable", type: "asset" },
    { code: "1010", name: "Allowance for Credit Losses (contra)", type: "asset" },
    { code: "1100", name: "Investment Portfolio", type: "asset" },
    { code: "2000", name: "Deposits / Member Shares", type: "liability" },
    { code: "3000", name: "Retained / Undivided Earnings", type: "equity" },
    { code: "3010", name: "Regular Reserves", type: "equity" },
    { code: "4000", name: "Interest Income — Loans", type: "revenue" },
    { code: "4010", name: "Interest Income — Investments", type: "revenue" },
    { code: "4020", name: "Fee & Service Charge Income", type: "revenue" },
    { code: "5000", name: "Interest / Dividend Expense", type: "expense" },
    { code: "5010", name: "Provision for Credit Losses", type: "expense" },
    { code: "5020", name: "Personnel Expense", type: "expense" },
    { code: "5030", name: "Occupancy & Operations Expense", type: "expense" },
    { code: "5040", name: "Exam & Compliance Costs", type: "expense" },
  ],
  "cooperative-equity": [
    { code: "2000", name: "Patronage Dividends Payable", type: "liability" },
    { code: "2010", name: "Equity Retirement Payable", type: "liability" },
    { code: "3000", name: "Allocated Member Equity", type: "equity" },
    { code: "3010", name: "Unallocated Retained Earnings", type: "equity" },
    { code: "3020", name: "Per-Unit Retains", type: "equity" },
    { code: "4000", name: "Member Sales Revenue", type: "revenue" },
    { code: "4010", name: "Non-Member Revenue", type: "revenue" },
    { code: "5000", name: "Cost of Goods & Services", type: "expense" },
    { code: "5010", name: "Operating Expenses", type: "expense" },
  ],
};

const PROFILES: Record<string, FinancialProfileSeed> = {
  healthcare_wellness: {
    billableTimeEnabled: true,
    archetypeCategory: "healthcare-wellness",
    displayName: "Healthcare & Wellness",
    defaultPaymentTerms: "Due on receipt",
    defaultCurrency: "GBP",
    vatRegistered: false,
    defaultTaxRate: 0,
    dunningEnabled: true,
    dunningStyle: "standard",
    recurringBillingEnabled: true,
    invoiceTemplateStyle: "professional",
    expenseCategories: [
      "Medical Supplies",
      "Equipment Maintenance",
      "Professional Development",
      "Insurance",
      "Software Subscriptions",
      "Premises & Utilities",
    ],
    purchaseOrdersEnabled: false,
    chartOfAccountsSeed: [
      { code: "4000", name: "Consultation Revenue", type: "revenue" },
      { code: "4010", name: "Treatment Revenue", type: "revenue" },
      { code: "4020", name: "Membership Income", type: "revenue" },
      { code: "5000", name: "Medical Supplies", type: "expense" },
      { code: "5010", name: "Equipment Depreciation", type: "expense" },
      { code: "5020", name: "Professional Indemnity Insurance", type: "expense" },
      { code: "5030", name: "CPD & Training", type: "expense" },
    ],
  },

  trades_construction: {
    billableTimeEnabled: true,
    archetypeCategory: "trades-maintenance",
    displayName: "Trades & Construction",
    defaultPaymentTerms: "Net 14",
    defaultCurrency: "GBP",
    vatRegistered: true,
    defaultTaxRate: 20,
    dunningEnabled: true,
    dunningStyle: "aggressive",
    recurringBillingEnabled: true,
    invoiceTemplateStyle: "trade",
    expenseCategories: [
      "Materials & Supplies",
      "Tools & Equipment",
      "Vehicle Running Costs",
      "Subcontractors",
      "Insurance",
      "Site Safety & PPE",
      "Waste Disposal",
    ],
    purchaseOrdersEnabled: true,
    chartOfAccountsSeed: [
      { code: "4000", name: "Labour Revenue", type: "revenue" },
      { code: "4010", name: "Materials Revenue", type: "revenue" },
      { code: "4020", name: "Maintenance Contract Income", type: "revenue" },
      { code: "5000", name: "Materials & Supplies", type: "expense" },
      { code: "5010", name: "Subcontractor Costs", type: "expense" },
      { code: "5020", name: "Plant Hire", type: "expense" },
      { code: "5030", name: "Vehicle Expenses", type: "expense" },
    ],
  },

  professional_services: {
    billableTimeEnabled: true,
    archetypeCategory: "professional-services",
    displayName: "Professional Services",
    defaultPaymentTerms: "Net 30",
    defaultCurrency: "GBP",
    vatRegistered: true,
    defaultTaxRate: 20,
    dunningEnabled: true,
    dunningStyle: "standard",
    recurringBillingEnabled: true,
    invoiceTemplateStyle: "professional",
    expenseCategories: [
      "Professional Development",
      "Software & Subscriptions",
      "Office & Admin",
      "Marketing",
      "Travel & Accommodation",
      "Professional Insurance",
    ],
    purchaseOrdersEnabled: false,
    chartOfAccountsSeed: [
      { code: "4000", name: "Consulting Fees", type: "revenue" },
      { code: "4010", name: "Retainer Income", type: "revenue" },
      { code: "4020", name: "Project Revenue", type: "revenue" },
      { code: "5000", name: "Professional Subscriptions", type: "expense" },
      { code: "5010", name: "Training & CPD", type: "expense" },
      { code: "5020", name: "Marketing & Business Development", type: "expense" },
      { code: "5030", name: "Travel & Subsistence", type: "expense" },
    ],
  },

  retail: {
    archetypeCategory: "retail-goods",
    displayName: "Retail",
    defaultPaymentTerms: "Due on receipt",
    defaultCurrency: "GBP",
    vatRegistered: true,
    defaultTaxRate: 20,
    dunningEnabled: true,
    dunningStyle: "gentle",
    recurringBillingEnabled: false,
    invoiceTemplateStyle: "minimal",
    expenseCategories: [
      "Cost of Goods Sold",
      "Packaging & Shipping",
      "Shop Premises",
      "Staff Costs",
      "Marketing & Advertising",
      "Payment Processing Fees",
    ],
    purchaseOrdersEnabled: true,
    chartOfAccountsSeed: [
      { code: "4000", name: "Product Sales", type: "revenue" },
      { code: "4010", name: "Shipping & Handling Income", type: "revenue" },
      { code: "5000", name: "Cost of Goods Sold", type: "expense" },
      { code: "5010", name: "Packaging Materials", type: "expense" },
      { code: "5020", name: "Rent & Business Rates", type: "expense" },
      { code: "5030", name: "Merchant Fees", type: "expense" },
    ],
  },

  education_training: {
    archetypeCategory: "education-training",
    displayName: "Education & Training",
    defaultPaymentTerms: "50% deposit",
    defaultCurrency: "GBP",
    vatRegistered: false,
    defaultTaxRate: 0,
    dunningEnabled: true,
    dunningStyle: "standard",
    recurringBillingEnabled: true,
    invoiceTemplateStyle: "professional",
    expenseCategories: [
      "Course Materials",
      "Venue Hire",
      "Software & Platforms",
      "Marketing",
      "Tutor Fees",
      "Accreditation & Compliance",
    ],
    purchaseOrdersEnabled: false,
    chartOfAccountsSeed: [
      { code: "4000", name: "Course Fees", type: "revenue" },
      { code: "4010", name: "Subscription Income", type: "revenue" },
      { code: "4020", name: "Workshop Revenue", type: "revenue" },
      { code: "5000", name: "Course Materials", type: "expense" },
      { code: "5010", name: "Venue & Facilities", type: "expense" },
      { code: "5020", name: "External Tutor Fees", type: "expense" },
      { code: "5030", name: "Platform & Technology", type: "expense" },
    ],
  },

  nonprofit: {
    archetypeCategory: "nonprofit-community",
    displayName: "Nonprofit",
    defaultPaymentTerms: "Donation receipt",
    defaultCurrency: "GBP",
    vatRegistered: false,
    defaultTaxRate: 0,
    dunningEnabled: false,
    dunningStyle: "off",
    recurringBillingEnabled: true,
    invoiceTemplateStyle: "nonprofit",
    expenseCategories: [
      "Programme Delivery",
      "Fundraising Costs",
      "Premises & Facilities",
      "Staff & Volunteer Costs",
      "Communications",
      "Governance & Compliance",
    ],
    purchaseOrdersEnabled: false,
    chartOfAccountsSeed: [
      { code: "4000", name: "Donations & Gifts", type: "revenue" },
      { code: "4010", name: "Grant Income", type: "revenue" },
      { code: "4020", name: "Recurring Giving Income", type: "revenue" },
      { code: "5000", name: "Programme Costs", type: "expense" },
      { code: "5010", name: "Fundraising Expenditure", type: "expense" },
      { code: "5020", name: "Administration Costs", type: "expense" },
    ],
  },

  food_hospitality: {
    archetypeCategory: "food-hospitality",
    displayName: "Food & Hospitality",
    defaultPaymentTerms: "Due on receipt",
    defaultCurrency: "GBP",
    vatRegistered: true,
    defaultTaxRate: 20,
    dunningEnabled: false,
    dunningStyle: "off",
    recurringBillingEnabled: false,
    invoiceTemplateStyle: "minimal",
    expenseCategories: [
      "Food & Beverage Purchases",
      "Kitchen Equipment",
      "Premises & Rates",
      "Staff Wages",
      "Licences & Compliance",
      "Marketing & Promotions",
      "Waste Management",
    ],
    purchaseOrdersEnabled: true,
    chartOfAccountsSeed: [
      { code: "4000", name: "Food & Drink Sales", type: "revenue" },
      { code: "4010", name: "Events & Catering Revenue", type: "revenue" },
      { code: "5000", name: "Food & Beverage Cost", type: "expense" },
      { code: "5010", name: "Kitchen & Equipment", type: "expense" },
      { code: "5020", name: "Premises Costs", type: "expense" },
      { code: "5030", name: "Wage Costs", type: "expense" },
    ],
  },

  fitness_recreation: {
    billableTimeEnabled: true,
    archetypeCategory: "fitness-recreation",
    displayName: "Fitness & Recreation",
    defaultPaymentTerms: "Monthly direct debit",
    defaultCurrency: "GBP",
    vatRegistered: true,
    defaultTaxRate: 20,
    dunningEnabled: true,
    dunningStyle: "standard",
    recurringBillingEnabled: true,
    invoiceTemplateStyle: "minimal",
    expenseCategories: [
      "Equipment & Maintenance",
      "Facilities & Rent",
      "Staff & Instructors",
      "Insurance",
      "Marketing",
      "Software & Booking Systems",
    ],
    purchaseOrdersEnabled: false,
    chartOfAccountsSeed: [
      { code: "4000", name: "Membership Income", type: "revenue" },
      { code: "4010", name: "Class & Session Revenue", type: "revenue" },
      { code: "4020", name: "Personal Training Revenue", type: "revenue" },
      { code: "5000", name: "Equipment Costs", type: "expense" },
      { code: "5010", name: "Facility Costs", type: "expense" },
      { code: "5020", name: "Instructor Fees", type: "expense" },
    ],
  },

  beauty_personal: {
    billableTimeEnabled: true,
    archetypeCategory: "beauty-personal-care",
    displayName: "Beauty & Personal Care",
    defaultPaymentTerms: "Due on receipt",
    defaultCurrency: "GBP",
    vatRegistered: false,
    defaultTaxRate: 0,
    dunningEnabled: true,
    dunningStyle: "gentle",
    recurringBillingEnabled: true,
    invoiceTemplateStyle: "creative",
    expenseCategories: [
      "Product & Supplies",
      "Equipment & Tools",
      "Premises & Rent",
      "Insurance",
      "Training & Development",
      "Marketing & Social Media",
    ],
    purchaseOrdersEnabled: false,
    chartOfAccountsSeed: [
      { code: "4000", name: "Treatment Revenue", type: "revenue" },
      { code: "4010", name: "Product Sales", type: "revenue" },
      { code: "4020", name: "Package & Plan Income", type: "revenue" },
      { code: "5000", name: "Products & Consumables", type: "expense" },
      { code: "5010", name: "Equipment & Tools", type: "expense" },
      { code: "5020", name: "Salon Rent & Rates", type: "expense" },
      { code: "5030", name: "Marketing & Promotions", type: "expense" },
    ],
  },

  hoa_property_management: {
    archetypeCategory: "hoa-property-management",
    displayName: "HOA & Property Management",
    defaultPaymentTerms: "Due on receipt",
    defaultCurrency: "USD",
    vatRegistered: false,
    defaultTaxRate: 0,
    dunningEnabled: true,
    dunningStyle: "aggressive",
    recurringBillingEnabled: true,
    invoiceTemplateStyle: "professional",
    expenseCategories: [
      "Common Area Maintenance",
      "Landscaping & Grounds",
      "Insurance",
      "Utilities (Common)",
      "Management Fees",
      "Reserve Fund Contributions",
      "Legal & Professional",
      "Repairs & Capital Improvements",
    ],
    purchaseOrdersEnabled: true,
    chartOfAccountsSeed: [
      { code: "4000", name: "Assessment Income", type: "revenue" },
      { code: "4010", name: "Special Assessment Income", type: "revenue" },
      { code: "4020", name: "Late Fees & Fines", type: "revenue" },
      { code: "4030", name: "Amenity Rental Income", type: "revenue" },
      { code: "5000", name: "Common Area Maintenance", type: "expense" },
      { code: "5010", name: "Landscaping & Grounds", type: "expense" },
      { code: "5020", name: "Insurance Premiums", type: "expense" },
      { code: "5030", name: "Utilities (Common Areas)", type: "expense" },
      { code: "5040", name: "Management Company Fees", type: "expense" },
      { code: "5050", name: "Legal & Professional Fees", type: "expense" },
      { code: "5060", name: "Reserve Fund Contribution", type: "expense" },
    ],
  },

  pet_services: {
    billableTimeEnabled: true,
    archetypeCategory: "pet-services",
    displayName: "Pet Services",
    defaultPaymentTerms: "Due on receipt",
    defaultCurrency: "GBP",
    vatRegistered: false,
    defaultTaxRate: 0,
    dunningEnabled: true,
    dunningStyle: "standard",
    recurringBillingEnabled: true,
    invoiceTemplateStyle: "minimal",
    expenseCategories: [
      "Pet Supplies & Products",
      "Veterinary & Insurance",
      "Premises & Kennels",
      "Vehicle & Travel",
      "Marketing",
      "Training & Certification",
    ],
    purchaseOrdersEnabled: false,
    chartOfAccountsSeed: [
      { code: "4000", name: "Service Revenue", type: "revenue" },
      { code: "4010", name: "Pet Plan Income", type: "revenue" },
      { code: "4020", name: "Product Sales", type: "revenue" },
      { code: "5000", name: "Pet Supplies", type: "expense" },
      { code: "5010", name: "Veterinary Costs", type: "expense" },
      { code: "5020", name: "Premises & Kennel Costs", type: "expense" },
      { code: "5030", name: "Vehicle & Travel", type: "expense" },
    ],
  },
  banking_financial_services: {
    archetypeCategory: "banking-financial-services",
    displayName: "Banking & Financial Services",
    defaultPaymentTerms: "Due on receipt",
    defaultCurrency: "USD",
    vatRegistered: false,
    defaultTaxRate: 0,
    dunningEnabled: false,
    dunningStyle: "gentle",
    recurringBillingEnabled: true,
    // Interest-margin P&L shape; the institution's core banking system stays
    // authoritative (BI-5D9DCDE6 spec D3 — DPF is the engagement layer).
    ledgerModel: "financial-institution",
    invoiceTemplateStyle: "professional",
    expenseCategories: [
      "Interest Expense",
      "Provision for Loan Losses",
      "Deposit Insurance Premiums",
      "Regulatory & Examination Fees",
      "Core Processing & Technology",
      "Branch Premises & Security",
      "Professional & Legal Fees",
    ],
    purchaseOrdersEnabled: false,
    chartOfAccountsSeed: LEDGER_FRAGMENTS_INTERNAL["financial-institution"],
    billingPatternProfile: {
      primaryPaymentPattern: "recurring-agreement",
      supportedPaymentPatterns: ["recurring-agreement", "ad-hoc-invoice"],
      invoiceExecutionMode: "prepared-not-prescribed",
      recurringBillingApplicability: "recommended",
    },
  },

  fund_accounting: {
    archetypeCategory: "public-sector",
    displayName: "Public Sector (Fund Accounting)",
    defaultPaymentTerms: "Due on receipt",
    defaultCurrency: "USD",
    vatRegistered: false,
    defaultTaxRate: 0,
    dunningEnabled: true,
    dunningStyle: "gentle",
    ledgerModel: "fund-accounting",
    billingPatternProfile: STATUTORY_FEES_PATTERN,
    invoiceTemplateStyle: "professional",
    expenseCategories: [
      "Personnel & Benefits",
      "Public Works & Streets",
      "Parks & Recreation",
      "Utilities (Facilities)",
      "Professional & Legal Services",
      "Equipment & Fleet",
      "Capital Projects",
      "Debt Service",
    ],
    purchaseOrdersEnabled: true,
    chartOfAccountsSeed: LEDGER_FRAGMENTS_INTERNAL["fund-accounting"],
  },

  software_platform: {
    archetypeCategory: "software-platform",
    displayName: "Software Platform (SaaS)",
    defaultPaymentTerms: "Net 30",
    defaultCurrency: "USD",
    vatRegistered: false,
    defaultTaxRate: 0,
    dunningEnabled: true,
    dunningStyle: "standard",
    recurringBillingEnabled: true,
    billingPatternProfile: SUBSCRIPTION_PATTERN,
    invoiceTemplateStyle: "professional",
    expenseCategories: [
      "Cloud Infrastructure & Hosting",
      "Software Subscriptions & SaaS Tools",
      "R&D Salaries & Contractors",
      "Customer Acquisition",
      "Security & Compliance",
      "Legal & Professional Fees",
      "General & Administrative",
    ],
    purchaseOrdersEnabled: false,
    chartOfAccountsSeed: [
      { code: "4000", name: "Subscription Revenue (MRR)", type: "revenue" },
      { code: "4010", name: "Usage-Based Revenue", type: "revenue" },
      { code: "4020", name: "Professional Services Revenue", type: "revenue" },
      { code: "4030", name: "Deferred Revenue", type: "liability" },
      { code: "5000", name: "Cloud Infrastructure (COGS)", type: "expense" },
      { code: "5010", name: "R&D Expenses", type: "expense" },
      { code: "5020", name: "Sales & Marketing", type: "expense" },
      { code: "5030", name: "General & Administrative", type: "expense" },
    ],
  },

  media_production: {
    archetypeCategory: "media-production",
    displayName: "Media & Production",
    defaultPaymentTerms: "Net 30",
    defaultCurrency: "GBP",
    vatRegistered: true,
    defaultTaxRate: 20,
    dunningEnabled: true,
    dunningStyle: "standard",
    // Project engagements bill against milestones; recurring is optional.
    billingPatternProfile: AD_HOC_INVOICE_PATTERN,
    invoiceTemplateStyle: "creative",
    expenseCategories: [
      "Crew & Talent Fees",
      "Equipment Hire",
      "Location & Studio",
      "Post-Production & Software",
      "Travel & Logistics",
      "Insurance & Permits",
      "Marketing & Business Development",
    ],
    purchaseOrdersEnabled: true,
    chartOfAccountsSeed: [
      { code: "4000", name: "Production Revenue", type: "revenue" },
      { code: "4010", name: "Post-Production Revenue", type: "revenue" },
      { code: "4020", name: "Licensing & Usage Fees", type: "revenue" },
      { code: "5000", name: "Crew & Talent Costs", type: "expense" },
      { code: "5010", name: "Equipment & Location", type: "expense" },
      { code: "5020", name: "Post & Software", type: "expense" },
      { code: "5030", name: "Travel & Logistics", type: "expense" },
    ],
  },

  live_events_venues: {
    archetypeCategory: "live-events-venues",
    displayName: "Live Events & Venues",
    defaultPaymentTerms: "Due on receipt",
    defaultCurrency: "GBP",
    vatRegistered: true,
    defaultTaxRate: 20,
    dunningEnabled: false,
    dunningStyle: "off",
    // Ticket revenue is transactional point-of-sale; hire/booking is ad-hoc.
    billingPatternProfile: POINT_OF_SALE_PATTERN,
    invoiceTemplateStyle: "minimal",
    expenseCategories: [
      "Artist & Talent Guarantees",
      "Venue & Facility Costs",
      "Production & Staging",
      "Marketing & Ticketing Fees",
      "Staffing & Security",
      "Licences & Insurance",
      "Hospitality & Catering",
    ],
    purchaseOrdersEnabled: true,
    chartOfAccountsSeed: [
      { code: "4000", name: "Ticket Sales", type: "revenue" },
      { code: "4010", name: "Venue Hire Income", type: "revenue" },
      { code: "4020", name: "Bar, Merch & Hospitality", type: "revenue" },
      { code: "4030", name: "Sponsorship Income", type: "revenue" },
      { code: "5000", name: "Artist & Talent Costs", type: "expense" },
      { code: "5010", name: "Production & Staging", type: "expense" },
      { code: "5020", name: "Marketing & Ticketing Fees", type: "expense" },
      { code: "5030", name: "Staffing & Security", type: "expense" },
    ],
  },

  warehousing_fulfilment: {
    archetypeCategory: "warehousing-fulfilment",
    displayName: "Warehousing & Fulfilment",
    defaultPaymentTerms: "Net 30",
    defaultCurrency: "GBP",
    vatRegistered: true,
    defaultTaxRate: 20,
    dunningEnabled: true,
    dunningStyle: "standard",
    // Contract accounts invoiced monthly off a rate card — storage accrual plus
    // handling activity — so periods are prepared, not charged at the point of
    // work.
    billingPatternProfile: RETAINER_PATTERN,
    invoiceTemplateStyle: "professional",
    expenseCategories: [
      "Warehouse Rent & Rates",
      "Warehouse Labour",
      "Materials Handling Equipment",
      "Packaging & Consumables",
      "Outbound Carriage",
      "Utilities & Refrigeration",
      "Insurance & Goods-in-Trust Cover",
      "WMS & Systems",
    ],
    purchaseOrdersEnabled: true,
    // The two meters are separate revenue lines on purpose: storage is rent on
    // space, handling is paid work, and a 3PL manages their margins apart.
    chartOfAccountsSeed: [
      { code: "4000", name: "Storage Revenue", type: "revenue" },
      { code: "4010", name: "Handling Revenue", type: "revenue" },
      { code: "4020", name: "Value-Added Services Revenue", type: "revenue" },
      { code: "4030", name: "Carriage Recharged", type: "revenue" },
      { code: "4040", name: "Accessorial Charges", type: "revenue" },
      { code: "5000", name: "Warehouse Rent & Rates", type: "expense" },
      { code: "5010", name: "Warehouse Labour", type: "expense" },
      { code: "5020", name: "Outbound Carriage", type: "expense" },
      { code: "5030", name: "Packaging & Consumables", type: "expense" },
      { code: "5040", name: "Utilities & Refrigeration", type: "expense" },
    ],
  },

  fabric_care_services: {
    archetypeCategory: "fabric-care-services",
    displayName: "Fabric Care Services",
    defaultPaymentTerms: "Due on receipt",
    defaultCurrency: "GBP",
    vatRegistered: true,
    defaultTaxRate: 20,
    dunningEnabled: true,
    dunningStyle: "gentle",
    billingPatternProfile: POINT_OF_SALE_PATTERN,
    invoiceTemplateStyle: "minimal",
    expenseCategories: [
      "Cleaning Supplies & Solvents",
      "Plant Labour",
      "Rent & Utilities",
      "Packaging Hangers & Tags",
      "Equipment Maintenance",
      "Delivery & Route Costs",
      "Alterations Subcontractors",
      "POS & Customer Notifications",
    ],
    purchaseOrdersEnabled: true,
    chartOfAccountsSeed: [
      { code: "4000", name: "Dry Cleaning Revenue", type: "revenue" },
      { code: "4010", name: "Laundry & Wash-Fold Revenue", type: "revenue" },
      { code: "4020", name: "Alterations & Repair Revenue", type: "revenue" },
      { code: "4030", name: "Pickup & Delivery Income", type: "revenue" },
      { code: "4040", name: "Commercial Account Revenue", type: "revenue" },
      { code: "5000", name: "Cleaning Supplies & Solvents", type: "expense" },
      { code: "5010", name: "Plant Labour", type: "expense" },
      { code: "5020", name: "Rent & Utilities", type: "expense" },
      { code: "5030", name: "Packaging Hangers & Tags", type: "expense" },
      { code: "5040", name: "Delivery & Route Costs", type: "expense" },
    ],
  },
  agriculture_ranching: {
    archetypeCategory: "agriculture-ranching",
    displayName: "Agriculture & Ranching",
    defaultPaymentTerms: "Due within 14 days",
    defaultCurrency: "USD",
    vatRegistered: false,
    defaultTaxRate: 0,
    dunningEnabled: true,
    dunningStyle: "standard",
    billingPatternProfile: AD_HOC_INVOICE_PATTERN,
    invoiceTemplateStyle: "trade",
    expenseCategories: [
      "Feed Seed & Fertility",
      "Veterinary Breeding & Farrier",
      "Fuel Lubricants & Utilities",
      "Equipment Repairs & Parts",
      "Custom Operators & Hauling",
      "Crop Protection & Application",
      "Land Rent Tax & Insurance",
      "Market Sale & Checkoff Costs",
    ],
    purchaseOrdersEnabled: true,
    chartOfAccountsSeed: [
      { code: "4000", name: "Livestock Sales", type: "revenue" },
      { code: "4010", name: "Crop Hay & Forage Sales", type: "revenue" },
      { code: "4020", name: "Grazing & Custom Service Revenue", type: "revenue" },
      { code: "4030", name: "Breeding & Other Farm Revenue", type: "revenue" },
      { code: "5000", name: "Feed Seed & Fertility", type: "expense" },
      { code: "5010", name: "Veterinary Breeding & Farrier", type: "expense" },
      { code: "5020", name: "Fuel Lubricants & Utilities", type: "expense" },
      { code: "5030", name: "Equipment Repairs & Parts", type: "expense" },
      { code: "5040", name: "Custom Operators & Hauling", type: "expense" },
    ],
  },
};

// ─── Exported functions ───────────────────────────────────────────────────────

function defaultBillingPatternForSlug(slug: string): BillingPatternProfile {
  switch (slug) {
    case "professional_services":
    case "hoa_property_management":
      return RECURRING_AGREEMENT_PATTERN;
    // Trades & construction work is predominantly ad-hoc / per-job invoicing
    // (electrician, landscaping, cleaning). Recurring agreements are still a
    // supported pattern, but per-job invoicing is the correct zero-touch
    // default — falls through to AD_HOC_INVOICE_PATTERN below.
    case "retail":
    case "food_hospitality":
      return POINT_OF_SALE_PATTERN;
    case "beauty_personal":
    case "pet_services":
      return APPOINTMENT_CHECKOUT_PATTERN;
    case "education_training":
    case "fitness_recreation":
    case "healthcare_wellness":
      return SUBSCRIPTION_PATTERN;
    case "nonprofit":
      return DONATION_PATTERN;
    default:
      return AD_HOC_INVOICE_PATTERN;
  }
}

export function deriveRecurringBillingEnabled(profile: BillingPatternProfile): boolean {
  return profile.recurringBillingApplicability !== "not-applicable";
}

function normalizeFinancialProfile(slug: string, profile: FinancialProfileSeed): FinancialProfile {
  const billingPatternProfile = profile.billingPatternProfile ?? defaultBillingPatternForSlug(slug);
  return {
    ...profile,
    billingPatternProfile,
    recurringBillingEnabled: deriveRecurringBillingEnabled(billingPatternProfile),
    ledgerModel: profile.ledgerModel ?? "commercial",
  };
}

export function getFinancialProfile(archetypeSlug: string): FinancialProfile | null {
  const profile = PROFILES[archetypeSlug];
  return profile ? normalizeFinancialProfile(archetypeSlug, profile) : null;
}

export function getAllProfiles(): Array<{ slug: string } & FinancialProfile> {
  return Object.entries(PROFILES).map(([slug, profile]) => ({
    slug,
    ...normalizeFinancialProfile(slug, profile),
  }));
}

export const LEDGER_COA_FRAGMENTS = LEDGER_FRAGMENTS_INTERNAL;
