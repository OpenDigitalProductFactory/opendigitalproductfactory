import { openIntent } from "@/lib/backlog/next-step-pointer";
import {
  normalizeReadinessCapability,
  type IntegrationReadinessCapability,
  type IntegrationReadinessDescriptor,
  type IntegrationReadinessState,
} from "@/lib/integrations/readiness";
import {
  QUICKBOOKS_IMPORT_STAGING_ENTITY_FAMILIES,
  buildQuickBooksImportStagingDescriptor,
  type QuickBooksImportStagingEntityFamily,
} from "./import-staging";

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
  "expenses",
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
  apiCoverageNote: string;
};

const QUICKBOOKS_CAPABILITIES: QuickBooksCapabilityTemplate[] = [
  {
    key: "company",
    label: "Company profile",
    description: "QuickBooks company identity and realm context.",
    supportedNow: true,
    nextAction: "Use company context for finance setup and readiness checks.",
    apiCoverageNote: "CompanyInfo endpoint is read through the Accounting API.",
  },
  {
    key: "customers",
    label: "Customers",
    description: "Customer directory records available through the Accounting API.",
    supportedNow: true,
    nextAction: "Use read coverage to plan customer import projection.",
    apiCoverageNote: "Customer query helper reads customer directory rows; no imports or writes.",
  },
  {
    key: "invoices",
    label: "Invoices",
    description: "Invoice records available through the Accounting API.",
    supportedNow: true,
    nextAction: "Use read coverage to plan invoice import projection.",
    apiCoverageNote: "Invoice query and direct invoice helpers read AR invoice context.",
  },
  {
    key: "vendors",
    label: "Vendors",
    description: "Vendor directory records that should map to DPF suppliers.",
    supportedNow: true,
    nextAction: "Use read coverage to plan source-attributed supplier staging.",
    apiCoverageNote: "QuickBooks Vendor query is the read anchor for supplier mapping.",
  },
  {
    key: "bills",
    label: "Bills",
    description: "Accounts payable bills that should map to DPF bills.",
    supportedNow: true,
    nextAction: "Use read coverage to plan source-attributed AP bill staging.",
    apiCoverageNote: "QuickBooks Bill query is the read anchor for AP bill mapping.",
  },
  {
    key: "expenses",
    label: "Expenses",
    description: "Purchase/expense transactions that should map to DPF expense evidence.",
    supportedNow: true,
    nextAction: "Use read coverage to plan source-attributed expense staging.",
    apiCoverageNote: "QuickBooks Purchase query is the read anchor for expense transactions.",
  },
  {
    key: "payments",
    label: "Payments",
    description: "Payment records and allocations for invoice settlement.",
    supportedNow: true,
    nextAction: "Use read coverage before Stripe/QuickBooks reconciliation work.",
    apiCoverageNote: "QuickBooks Payment query reads AR payment objects; BillPayment remains a later AP enhancement.",
  },
  {
    key: "accounts",
    label: "Accounts",
    description: "Chart of accounts data required before ledger dual-run.",
    supportedNow: true,
    nextAction: "Use chart-of-accounts reads for later ledger and report comparison.",
    apiCoverageNote: "QuickBooks Account query reads chart-of-accounts records without ledger ownership.",
  },
  {
    key: "bank_transactions",
    label: "Bank transactions",
    description: "Bank and card transaction context used for reconciliation.",
    supportedNow: false,
    nextAction: "Decide QuickBooks, Xero, or Plaid feed ownership before mapping.",
    apiCoverageNote: "Bank-feed ownership remains blocked pending the provider posture decision.",
  },
  {
    key: "reports",
    label: "Reports",
    description: "Accounting reports used to validate DPF dual-run outputs.",
    supportedNow: true,
    nextAction: "Use report reads for operational comparison only; do not claim close authority.",
    apiCoverageNote: "QuickBooks Reports API read helper supports P&L, balance sheet, and cash-flow snapshots.",
  },
  {
    key: "tax",
    label: "Tax",
    description: "Tax posture and reporting context used for evidence checks.",
    supportedNow: false,
    nextAction: "Map tax reporting context without taking filing authority.",
    apiCoverageNote: "Tax calculation and filing authority remain integration-led/specialist-led.",
  },
  {
    key: "accountant_workflow",
    label: "Accountant workflow",
    description: "Accountant handoff and evidence review workflow.",
    supportedNow: false,
    nextAction: "Design the accountant evidence packet before enabling this workflow.",
    apiCoverageNote: "Accountant collaboration is a workflow capability, not a QuickBooks entity read.",
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
  const importStaging = buildQuickBooksImportStagingDescriptor();
  const importReview = {
    status: isConnected ? "ready-to-review" : "not-started",
    sourceProvider: "quickbooks",
    readOnly: true,
    nextStep: openIntent("Entity links and review queue"),
    families: Array.from(QUICKBOOKS_IMPORT_STAGING_ENTITY_FAMILIES),
    guardrail:
      "Review queue records are DPF-held posture only; staged QuickBooks source records stay non-editable and external-owned until entity links are approved.",
  } as const;

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
          supportsImportStaging: isImportStagingFamily(capability.key),
        }),
        operatingMode: "integration-led",
        supportedNow: capability.supportedNow,
        hiveTag: "hive:aggregate-only",
        nextAction: capability.nextAction,
        apiCoverageNote: capability.apiCoverageNote,
        unreachableStates:
          capability.key === "tax" || capability.key === "accountant_workflow"
            ? ["dpf-primary"]
            : undefined,
      }),
    ),
    importStaging,
    importReview,
    nextSafeActions: resolveNextSafeActions(status),
    updatedAt: connection?.lastTestedAt ?? null,
  };
}

function resolveCapabilityState({
  status,
  supportedNow,
  isAuthError,
  supportsImportStaging,
}: {
  status: QuickBooksReadinessConnection["status"];
  supportedNow: boolean;
  isAuthError: boolean;
  supportsImportStaging: boolean;
}): IntegrationReadinessState {
  if (status === "unconfigured") {
    return "not-connected";
  }

  if (status === "error" && supportedNow && isAuthError) {
    return "credential-expired";
  }

  if (status === "connected" && supportedNow && supportsImportStaging) {
    return "import-ready";
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
      "Use expanded QuickBooks read coverage to plan source-attributed staging before imports or writes",
      "Review non-editable import staging fields before creating local accounting links",
      "Persist reviewed import candidates before reconciliation",
      "Keep bank feeds, tax authority, and accountant workflow blocked until their ownership gates are designed",
      "Keep write operations blocked until proposal-mode approval exists",
    ];
  }

  if (status === "error") {
    return ["Reconnect QuickBooks credentials", "Review the last probe error"];
  }

  return ["Connect QuickBooks credentials"];
}

function isImportStagingFamily(key: QuickBooksEntityFamily): key is QuickBooksImportStagingEntityFamily {
  return QUICKBOOKS_IMPORT_STAGING_ENTITY_FAMILIES.includes(
    key as QuickBooksImportStagingEntityFamily,
  );
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
