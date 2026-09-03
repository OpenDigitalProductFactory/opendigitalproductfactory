import type { FinanceInvoiceEntryPoint, FinanceMoneyJob } from "./finance-surface";

export const PET_RESCUE_MONEY_JOBS: FinanceMoneyJob[] = [
  {
    id: "contributions-received",
    label: "Donations & grants received",
    question: "Funding received this month for animals and community care.",
    href: "/finance/payments",
    kind: "monitor",
    metricKey: "money-in-month",
  },
  {
    id: "pledges-grants-outstanding",
    label: "Pledges & grants outstanding",
    question: "Committed donation and grant funding still to collect.",
    href: "/finance/invoices",
    kind: "monitor",
    metricKey: "outstanding-receivables",
  },
  {
    id: "overdue-commitments",
    label: "Overdue commitments",
    question: "Supporter and funder commitments now past their expected date.",
    href: "/finance/reports/aged-debtors",
    kind: "monitor",
    metricKey: "overdue-count",
  },
  {
    id: "animal-care-bills",
    label: "Animal care bills",
    question: "Veterinary, food, shelter, and care bills waiting to be paid.",
    href: "/finance/bills",
    kind: "monitor",
    metricKey: "supplier-bills-due",
  },
  {
    id: "cash-stewardship",
    label: "Cash available for care",
    question: "Available funds across accounts supporting animal care.",
    href: "/finance/banking",
    kind: "monitor",
    metricKey: "cash-position",
  },
];

export const PET_RESCUE_ENTRY_POINTS: FinanceInvoiceEntryPoint[] = [
  {
    id: "donation",
    label: "Donation",
    description: "Record a donation from a supporter.",
    href: "/finance/invoices/new?from=donation",
  },
  {
    id: "grant",
    label: "Grant",
    description: "Record grant funding awarded for rescue work.",
    href: "/finance/invoices/new?from=grant",
  },
  {
    id: "sponsorship",
    label: "Sponsorship",
    description: "Record an animal or programme sponsorship.",
    href: "/finance/invoices/new?from=sponsorship",
  },
  {
    id: "blank",
    label: "Other contribution",
    description: "Record another funding contribution.",
    href: "/finance/invoices/new",
  },
];
