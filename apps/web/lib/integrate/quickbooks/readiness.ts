import {
  normalizeReadinessCapability,
  type IntegrationReadinessCapability,
  type IntegrationReadinessDescriptor,
  type IntegrationReadinessState,
} from "@/lib/integrate/readiness";

export type QuickBooksReadinessConnection = {
  status: "unconfigured" | "connected" | "error";
  companyName: string | null;
  realmId: string | null;
  lastErrorMsg: string | null;
  lastTestedAt: string | null;
  environment: "sandbox" | "production" | null;
};

export const QUICKBOOKS_READINESS_ENTITY_FAMILIES = [
  "company",
  "customers",
  "invoices",
  "vendors",
  "bills",
  "payments",
  "accounts",
  "bank_transactions",
  "reports",
  "tax",
  "accountant_workflow",
] as const;

type QuickBooksEntityFamily = (typeof QUICKBOOKS_READINESS_ENTITY_FAMILIES)[number];

type QuickBooksCapabilityTemplate = {
  key: QuickBooksEntityFamily;
  label: string;
  description: string;
  supportedNow: boolean;
  nextAction: string;
};

const QUICKBOOKS_CAPABILITIES: QuickBooksCapabilityTemplate[] = [
  {
    key: "company",
    label: "Company profile",
    description: "QuickBooks company identity and realm context.",
    supportedNow: true,
    nextAction: "Use company context for finance setup and readiness checks.",
  },
  {
    key: "customers",
    label: "Customers",
    description: "Customer directory records available through the Accounting API.",
    supportedNow: true,
    nextAction: "Use read coverage to plan customer import projection.",
  },
  {
    key: "invoices",
    label: "Invoices",
    description: "Invoice records available through the Accounting API.",
    supportedNow: true,
    nextAction: "Use read coverage to plan invoice import projection.",
  },
  {
    key: "vendors",
    label: "Vendors",
    description: "Vendor directory records that should map to DPF suppliers.",
    supportedNow: false,
    nextAction: "Map the QuickBooks Vendor entity before import.",
  },
  {
    key: "bills",
    label: "Bills",
    description: "Accounts payable bills that should map to DPF bills.",
    supportedNow: false,
    nextAction: "Map the QuickBooks Bill entity before import.",
  },
  {
    key: "payments",
    label: "Payments",
    description: "Payment records and allocations for invoice settlement.",
    supportedNow: false,
    nextAction: "Map payment and allocation reads before reconciliation.",
  },
  {
    key: "accounts",
    label: "Accounts",
    description: "Chart of accounts data required before ledger dual-run.",
    supportedNow: false,
    nextAction: "Map chart of accounts reads before accounting-core work.",
  },
  {
    key: "bank_transactions",
    label: "Bank transactions",
    description: "Bank and card transaction context used for reconciliation.",
    supportedNow: false,
    nextAction: "Decide QuickBooks, Xero, or Plaid feed ownership before mapping.",
  },
  {
    key: "reports",
    label: "Reports",
    description: "Accounting reports used to validate DPF dual-run outputs.",
    supportedNow: false,
    nextAction: "Map report reads before dual-run comparison.",
  },
  {
    key: "tax",
    label: "Tax",
    description: "Tax posture and reporting context used for evidence checks.",
    supportedNow: false,
    nextAction: "Map tax reporting context without taking filing authority.",
  },
  {
    key: "accountant_workflow",
    label: "Accountant workflow",
    description: "Accountant handoff and evidence review workflow.",
    supportedNow: false,
    nextAction: "Design the accountant evidence packet before enabling this workflow.",
  },
];

export function buildQuickBooksReadinessDescriptor({
  connection,
}: {
  connection: QuickBooksReadinessConnection | null;
}): IntegrationReadinessDescriptor {
  const status = connection?.status ?? "unconfigured";
  const isConnected = status === "connected";
  const isError = status === "error";
  const isAuthError = isError && isCredentialError(connection?.lastErrorMsg);

  return {
    schemaVersion: "1.0",
    provider: "quickbooks",
    integrationId: "quickbooks-online-accounting",
    displayName: "QuickBooks Online",
    summary:
      "Read-only accounting readiness map for QuickBooks import, dual-run, and DPF-primary migration.",
    environment: connection?.environment ?? null,
    entityContext: {
      companyName: connection?.companyName ?? null,
      realmId: connection?.realmId ?? null,
    },
    health: {
      credentialStatus: isConnected ? "connected" : isError ? "error" : "not-connected",
      lastSuccessfulProbeAt: isConnected ? connection?.lastTestedAt ?? null : null,
      lastProbeErrorCategory: isError ? connection?.lastErrorMsg ?? "Unknown QuickBooks error" : null,
      timeUntilExpiry: null,
    },
    capabilities: QUICKBOOKS_CAPABILITIES.map((capability) =>
      normalizeReadinessCapability({
        key: capability.key,
        label: capability.label,
        description: capability.description,
        state: resolveCapabilityState({
          status,
          supportedNow: capability.supportedNow,
          isAuthError,
        }),
        operatingMode: "integration-led",
        supportedNow: capability.supportedNow,
        hiveTag: "hive:aggregate-only",
        nextAction: capability.nextAction,
        unreachableStates:
          capability.key === "tax" || capability.key === "accountant_workflow"
            ? ["dpf-primary"]
            : undefined,
      }),
    ),
    nextSafeActions: resolveNextSafeActions(status),
    updatedAt: connection?.lastTestedAt ?? null,
  };
}

function resolveCapabilityState({
  status,
  supportedNow,
  isAuthError,
}: {
  status: QuickBooksReadinessConnection["status"];
  supportedNow: boolean;
  isAuthError: boolean;
}): IntegrationReadinessState {
  if (status === "unconfigured") {
    return "not-connected";
  }

  if (status === "error" && supportedNow && isAuthError) {
    return "credential-expired";
  }

  if (status === "connected" && supportedNow) {
    return "read";
  }

  return "not-mapped";
}

function resolveNextSafeActions(status: QuickBooksReadinessConnection["status"]): string[] {
  if (status === "connected") {
    return [
      "Review mapped read coverage",
      "Plan QuickBooks read expansion for vendors, bills, payments, accounts, bank transactions, reports, tax, and accountant workflow",
      "Keep write operations blocked until proposal-mode approval exists",
    ];
  }

  if (status === "error") {
    return ["Reconnect QuickBooks credentials", "Review the last probe error"];
  }

  return ["Connect QuickBooks credentials"];
}

function isCredentialError(message: string | null | undefined): boolean {
  if (!message) {
    return false;
  }

  const normalized = message.toLowerCase();
  return (
    normalized.includes("credential") ||
    normalized.includes("unauthorized") ||
    normalized.includes("token") ||
    normalized.includes("auth")
  );
}
