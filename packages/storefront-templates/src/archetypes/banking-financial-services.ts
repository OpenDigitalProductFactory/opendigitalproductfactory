import type { ArchetypeDefinition, SchedulingDefaults } from "../types";

// BIAN-grounded banking archetypes (BI-5D9DCDE6, EP-ARCH-8D4F2A).
//
// Item templates, service categories, and capability vocabulary derive from the
// BIAN Service Landscape v14.0 Value Chain View — the canonical reference data
// lives at docs/Reference/bian/bian-v14-service-landscape.json. Each item names
// the BIAN Service Domain it represents so hive-mind comparison across banking
// installs stays anchored to the standard. Design spec:
// docs/superpowers/specs/2026-06-09-bian-banking-archetypes-design.md
//
// Scope note: these archetypes are the ENGAGEMENT layer (storefront, inquiry/
// application intake, branch appointments, capability map). Core banking
// execution, KYC/AML execution, and payment rails stay with the institution's
// core systems — see spec §5 Non-Goals.

// Default seed content for the loan calculator section.
// Operators can override these in admin once the section exists.
// Rate is illustrative only — see disclaimer.
const CALCULATOR_DEFAULT_CONTENT = {
  defaultRatePercent: 6.5,
  defaultTermYears: 30,
  showDownPayment: true,
  disclaimer:
    "For illustrative purposes only. Not a loan offer or commitment to lend. Actual rates and payments depend on credit profile, loan program, and property. All loans subject to credit approval.",
};

const INQUIRY_BASE_FIELDS = [
  { name: "name", label: "Full name", type: "text" as const, required: true },
  { name: "email", label: "Email", type: "email" as const, required: true },
  { name: "phone", label: "Phone", type: "tel" as const, required: false },
];

// Branch / advisor appointments are slot-booked during business hours.
const BRANCH_APPOINTMENT_SCHEDULING: SchedulingDefaults = {
  schedulingPattern: "slot",
  assignmentMode: "customer-choice",
  defaultOperatingHours: [
    { day: 1, start: "09:00", end: "17:00" },
    { day: 2, start: "09:00", end: "17:00" },
    { day: 3, start: "09:00", end: "17:00" },
    { day: 4, start: "09:00", end: "17:00" },
    { day: 5, start: "09:00", end: "17:00" },
  ],
  defaultBeforeBuffer: 0,
  defaultAfterBuffer: 10,
  minimumNoticeHours: 4,
  maxAdvanceDays: 30,
};

// Shared activation posture (spec §7): engagement-layer banking. KYC-gated
// account provisioning and account-based fees are existing axis values built
// for exactly this shape; billing stays prepared-not-prescribed (DPF records
// fee obligations, never moves money).
const BANKING_ACTIVATION_BASE = {
  profileType: "standard" as const,
  modules: [
    "customer-estate" as const,
    "service-agreements" as const,
    "billing-readiness" as const,
    "lifecycle-signals" as const,
    "integrations" as const,
  ],
  billingReadinessMode: "prepared-not-prescribed" as const,
  customerGraph: "separate-customer-projection" as const,
  estateSeparation: "strict" as const,
  axes: {
    form: "services" as const,
    delivery: "hybrid" as const,
    primaryConsumer: "individual" as const,
    consumptionChannel: "multi-channel" as const,
    commercialModel: "account-based-fees" as const,
    provisioning: "account-with-kyc" as const,
    platform: "no" as const,
  },
};

export const bankingFinancialServicesArchetypes: ArchetypeDefinition[] = [
  {
    archetypeId: "community-bank",
    name: "Community Bank",
    category: "banking-financial-services",
    ctaType: "inquiry",
    tags: ["bank", "banking", "deposits", "loans", "BIAN"],
    itemTemplates: [
      // BIAN Service Domain: Current Account (Loans and Deposits)
      { name: "Checking Account", description: "Everyday checking with debit card and online access", priceType: "from" },
      // BIAN Service Domain: Savings Account (Loans and Deposits)
      { name: "Savings Account", description: "Interest-bearing savings — rates shown as APY", priceType: "from" },
      // BIAN Service Domain: Term Deposit (Loans and Deposits)
      { name: "Certificate of Deposit", description: "Fixed-term deposit with guaranteed APY", priceType: "fixed" },
      // BIAN Service Domain: Consumer Loan (Loans and Deposits)
      { name: "Personal Loan", description: "Unsecured personal lending — rates shown as APR", priceType: "from" },
      // BIAN Service Domain: Mortgage Loan (Loans and Deposits)
      { name: "Mortgage", description: "Home purchase and refinance lending", priceType: "quote", ctaLabel: "Apply" },
      // BIAN Service Domain: Corporate Loan (Loans and Deposits)
      { name: "Business Loan", description: "Lending for local businesses — term loans and lines of credit", priceType: "quote", ctaLabel: "Apply" },
      // BIAN Business Domain: Cards
      { name: "Debit & Credit Cards", description: "Card products with local servicing", priceType: "from" },
      // BIAN Service Domain: Bank Customer Contact Handling (Customer Care / Servicing)
      { name: "Meet with a Banker", description: "30-minute branch or video appointment", priceType: "free", ctaType: "booking", bookingDurationMinutes: 30 },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Products & Rates", sortOrder: 1 },
      { type: "about", title: "About the Bank", sortOrder: 2 },
      { type: "team", title: "Our Bankers", sortOrder: 3 },
      { type: "contact", title: "Visit a Branch", sortOrder: 4 },
      { type: "calculator", title: "Loan Calculator", sortOrder: 5, content: CALCULATOR_DEFAULT_CONTENT },
      { type: "disclosures", title: "Disclosures", sortOrder: 6 },
    ],
    formSchema: [
      ...INQUIRY_BASE_FIELDS,
      { name: "productInterest", label: "What are you interested in?", type: "select" as const, required: true, options: ["Checking", "Savings", "Certificate of Deposit", "Personal Loan", "Mortgage", "Business Banking", "Cards", "Other"] },
      { name: "existingCustomer", label: "Are you an existing customer?", type: "select" as const, required: false, options: ["Yes", "No"] },
      { name: "currentSituation", label: "Anything else we should know?", type: "textarea" as const, required: false },
    ],
    schedulingDefaults: BRANCH_APPOINTMENT_SCHEDULING,
    activationProfile: {
      ...BANKING_ACTIVATION_BASE,
      seededServiceCategories: [
        // kebab-case BIAN Business/Service Domain names (Value Chain View)
        "loans-and-deposits",
        "cards",
        "relationship-management",
        "customer-care",
        "sales",
        "party-reference",
        "compliance",
        "credit-risk",
      ],
    },
  },
  {
    archetypeId: "credit-union",
    name: "Credit Union",
    category: "banking-financial-services",
    ctaType: "inquiry",
    tags: ["credit union", "members", "share accounts", "cooperative", "BIAN"],
    itemTemplates: [
      // BIAN Service Domain: Savings Account — credit-union share vocabulary
      { name: "Share Savings", description: "Member share savings account — dividends shown as APY", priceType: "from" },
      // BIAN Service Domain: Current Account
      { name: "Share Draft Checking", description: "Member checking with debit card and online access", priceType: "from" },
      // BIAN Service Domain: Term Deposit
      { name: "Share Certificate", description: "Fixed-term share certificate with guaranteed APY", priceType: "fixed" },
      // BIAN Service Domain: Consumer Loan
      { name: "Auto Loan", description: "New and used vehicle lending — rates shown as APR", priceType: "from" },
      // BIAN Service Domain: Consumer Loan
      { name: "Personal Loan", description: "Unsecured member lending", priceType: "from" },
      // BIAN Service Domains: Mortgage Loan + Consumer Loan (HELOC)
      { name: "Mortgage & HELOC", description: "Home loans and home-equity lines for members", priceType: "quote", ctaLabel: "Apply" },
      // BIAN Service Domain: Party Lifecycle Management (Party Reference)
      { name: "Become a Member", description: "Join the credit union — membership eligibility check", priceType: "free", ctaLabel: "Join" },
      // BIAN Service Domain: Bank Customer Contact Handling
      { name: "Meet with a Member Advisor", description: "30-minute branch or video appointment", priceType: "free", ctaType: "booking", bookingDurationMinutes: 30 },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Rates & Products", sortOrder: 1 },
      { type: "about", title: "Membership", sortOrder: 2 },
      { type: "team", title: "Member Advisors", sortOrder: 3 },
      { type: "contact", title: "Visit a Branch", sortOrder: 4 },
      { type: "calculator", title: "Loan Calculator", sortOrder: 5, content: CALCULATOR_DEFAULT_CONTENT },
      { type: "disclosures", title: "Disclosures", sortOrder: 6 },
    ],
    formSchema: [
      ...INQUIRY_BASE_FIELDS,
      { name: "eligibility", label: "Membership eligibility", type: "select" as const, required: true, options: ["I live/work in the area", "My employer participates", "Family member is a member", "Not sure"] },
      { name: "productInterest", label: "What are you interested in?", type: "select" as const, required: false, options: ["Membership", "Share Savings", "Checking", "Share Certificate", "Auto Loan", "Mortgage / HELOC", "Other"] },
      { name: "currentSituation", label: "Anything else we should know?", type: "textarea" as const, required: false },
    ],
    schedulingDefaults: BRANCH_APPOINTMENT_SCHEDULING,
    // Leaf-level override: member-owned cooperative vocabulary (NCUA framing)
    // over the banking category defaults. Merged via customVocabulary.
    vocabulary: {
      stakeholderLabel: "Members",
      teamLabel: "Member Advisors",
      inboxLabel: "Membership & Loan Applications",
      agentName: "Member Relationship Manager",
    },
    activationProfile: {
      ...BANKING_ACTIVATION_BASE,
      axes: {
        ...BANKING_ACTIVATION_BASE.axes,
        // Member-owned cooperative — uses the civic substrate's `member`
        // consumer and `member-owned` governance (BI-938D1B71), which derive
        // member-governance, membership-eligibility, and member-equity
        // capabilities. Field-of-membership eligibility is the defining
        // credit-union intake gate (NCUA charter posture, spec §3.4).
        primaryConsumer: "member" as const,
        governance: "member-owned" as const,
      },
      // member-owned derives member-equity as recommended, but a credit union
      // distributes dividends and holds member shares through the core banking
      // system — it does NOT run patronage-equity allocation/retirement (a co-op
      // concept). Suppress the /member-equity surface so it doesn't mislead
      // (BI-D9ACE184; civic spec §9 row "Member equity / patronage" = n/a for CUs).
      capabilityOverrides: [
        {
          capabilityKey: "member-equity",
          applicability: "not-applicable" as const,
          reason: "Credit unions distribute dividends and hold member shares via the core banking system, not patronage-equity allocation/retirement.",
        },
      ],
      seededServiceCategories: [
        "loans-and-deposits",
        "cards",
        "relationship-management",
        "customer-care",
        "party-reference",
        "compliance",
        "credit-risk",
      ],
    },
  },
  {
    archetypeId: "mortgage-lending",
    name: "Mortgage Lender & Broker",
    category: "banking-financial-services",
    ctaType: "inquiry",
    tags: ["mortgage", "lending", "home loans", "NMLS", "BIAN"],
    itemTemplates: [
      // BIAN Service Domains: Underwriting + Customer Credit Rating
      { name: "Pre-Approval", description: "Find out what you can borrow before you shop", priceType: "free", ctaLabel: "Get pre-approved" },
      // BIAN Service Domain: Mortgage Loan
      { name: "Purchase Mortgage", description: "Fixed and adjustable home purchase loans — rates shown as APR", priceType: "from", ctaLabel: "Apply" },
      // BIAN Service Domain: Mortgage Loan
      { name: "Refinance", description: "Rate-and-term or cash-out refinancing", priceType: "from", ctaLabel: "Apply" },
      // BIAN Service Domain: Consumer Loan (HELOC)
      { name: "HELOC", description: "Home equity line of credit", priceType: "from", ctaLabel: "Apply" },
      // BIAN Service Domain: Sales / Customer Offer
      { name: "Rate Quote", description: "Personalized rate quote for your scenario", priceType: "quote", ctaLabel: "Get a quote" },
      // BIAN Service Domain: Bank Customer Contact Handling
      { name: "Meet with a Loan Officer", description: "30-minute consultation, phone or video", priceType: "free", ctaType: "booking", bookingDurationMinutes: 30 },
    ],
    sectionTemplates: [
      { type: "hero", title: "Hero", sortOrder: 0 },
      { type: "items", title: "Loan Programs & Rates", sortOrder: 1 },
      { type: "about", title: "About Us", sortOrder: 2 },
      { type: "team", title: "Loan Officers", sortOrder: 3 },
      { type: "testimonials", title: "Client Stories", sortOrder: 4 },
      { type: "contact", title: "Talk to Us", sortOrder: 5 },
      { type: "calculator", title: "Loan Calculator", sortOrder: 6, content: CALCULATOR_DEFAULT_CONTENT },
      { type: "disclosures", title: "Disclosures", sortOrder: 7 },
    ],
    formSchema: [
      ...INQUIRY_BASE_FIELDS,
      { name: "loanPurpose", label: "Loan purpose", type: "select" as const, required: true, options: ["Purchase", "Refinance", "Cash-out refinance", "HELOC", "Pre-approval", "Not sure"] },
      { name: "propertyType", label: "Property type", type: "select" as const, required: false, options: ["Single family", "Condo / townhome", "Multi-family", "Manufactured", "Land"] },
      { name: "priceRange", label: "Estimated price range", type: "select" as const, required: false, options: ["Under $200k", "$200k–$400k", "$400k–$700k", "$700k–$1M", "$1M+"] },
      { name: "currentSituation", label: "Tell us about your scenario", type: "textarea" as const, required: false },
    ],
    schedulingDefaults: BRANCH_APPOINTMENT_SCHEDULING,
    vocabulary: {
      stakeholderLabel: "Borrowers",
      teamLabel: "Loan Officers",
      inboxLabel: "Loan Applications",
      agentName: "Loan Advisor",
    },
    activationProfile: {
      ...BANKING_ACTIVATION_BASE,
      seededServiceCategories: [
        "loans-and-deposits",
        "sales",
        "relationship-management",
        "customer-care",
        "compliance",
        "credit-risk",
      ],
    },
  },
];
