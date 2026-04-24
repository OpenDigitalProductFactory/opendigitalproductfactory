export type FinanceFamilyKey =
  | "overview"
  | "revenue"
  | "spend"
  | "close"
  | "configuration";

export type FinanceFamily = {
  key: FinanceFamilyKey;
  label: string;
  href: string;
  description: string;
  matchPrefixes: string[];
  subItems: Array<{ label: string; href: string }>;
};

export const FINANCE_FAMILIES: FinanceFamily[] = [
  {
    key: "overview",
    label: "Overview",
    href: "/finance",
    description: "See cash position, near-term risk, and the next finance workflows to run.",
    matchPrefixes: ["/finance"],
    subItems: [],
  },
  {
    key: "revenue",
    label: "Revenue",
    href: "/finance/revenue",
    description: "Manage invoices, receivables, collections, and expected inflows.",
    matchPrefixes: ["/finance/revenue", "/finance/invoices", "/finance/payments"],
    subItems: [
      { label: "Revenue Hub", href: "/finance/revenue" },
      { label: "Invoices", href: "/finance/invoices" },
      { label: "Payments", href: "/finance/payments" },
    ],
  },
  {
    key: "spend",
    label: "Spend",
    href: "/finance/spend",
    description: "Handle bills, suppliers, expenses, and outgoing cash commitments.",
    matchPrefixes: [
      "/finance/spend",
      "/finance/bills",
      "/finance/expense-claims",
      "/finance/my-expenses",
      "/finance/suppliers",
      "/finance/purchase-orders",
    ],
    subItems: [
      { label: "Spend Hub", href: "/finance/spend" },
      { label: "Bills", href: "/finance/bills" },
      { label: "Suppliers", href: "/finance/suppliers" },
      { label: "Expenses", href: "/finance/expense-claims" },
    ],
  },
  {
    key: "close",
    label: "Close",
    href: "/finance/close",
    description: "Run reporting, recurring work, payment runs, and close-oriented checks.",
    matchPrefixes: [
      "/finance/close",
      "/finance/reports",
      "/finance/recurring",
      "/finance/assets",
      "/finance/payment-runs",
    ],
    subItems: [
      { label: "Close Hub", href: "/finance/close" },
      { label: "Reports", href: "/finance/reports" },
      { label: "Recurring", href: "/finance/recurring" },
      { label: "Payment Runs", href: "/finance/payment-runs" },
    ],
  },
  {
    key: "configuration",
    label: "Configuration",
    href: "/finance/configuration",
    description: "Adjust banking, currency, dunning, and one-time finance setup.",
    matchPrefixes: [
      "/finance/configuration",
      "/finance/settings",
      "/finance/banking",
    ],
    subItems: [
      { label: "Configuration Hub", href: "/finance/configuration" },
      { label: "Settings", href: "/finance/settings" },
      { label: "Currency", href: "/finance/settings/currency" },
      { label: "Dunning", href: "/finance/settings/dunning" },
      { label: "Tax Remittance", href: "/finance/settings/tax" },
      { label: "Banking", href: "/finance/banking" },
    ],
  },
];

function matchesPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function getFinanceFamily(pathname: string): FinanceFamily {
  if (pathname === "/finance" || pathname === "/finance/") {
    return FINANCE_FAMILIES[0];
  }

  return (
    FINANCE_FAMILIES.find((family) =>
      family.key === "overview"
        ? pathname === family.href || pathname === `${family.href}/`
        : family.matchPrefixes.some((prefix) => matchesPrefix(pathname, prefix)),
    ) ?? FINANCE_FAMILIES[0]
  );
}
