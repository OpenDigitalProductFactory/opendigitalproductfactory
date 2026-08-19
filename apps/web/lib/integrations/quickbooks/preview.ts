import { prisma } from "@dpf/db";
import { decryptJson, encryptJson } from "@/lib/govern/credential-crypto";
import {
  getQuickBooksInvoice,
  listQuickBooksCustomers,
  listQuickBooksInvoices,
  probeQuickBooksAccounting,
  type ProbeQuickBooksAccountingResult,
  type QuickBooksCustomer,
  type QuickBooksInvoice,
} from "./accounting-client";
import {
  exchangeRefreshToken,
  type ExchangeRefreshTokenResult,
} from "./token-client";

const INTEGRATION_ID = "quickbooks-online-accounting";

interface StoredQuickBooksFields {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  realmId?: string;
  environment?: "sandbox" | "production";
  companyName?: string | null;
}

interface QuickBooksPreviewDeps {
  exchangeRefreshToken?: (args: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  }) => Promise<ExchangeRefreshTokenResult>;
  probeQuickBooksAccounting?: (args: {
    environment: "sandbox" | "production";
    realmId: string;
    accessToken: string;
  }) => Promise<ProbeQuickBooksAccountingResult>;
  listQuickBooksCustomers?: (args: {
    environment: "sandbox" | "production";
    realmId: string;
    accessToken: string;
    limit: number;
  }) => Promise<QuickBooksCustomer[]>;
  listQuickBooksInvoices?: (args: {
    environment: "sandbox" | "production";
    realmId: string;
    accessToken: string;
    limit: number;
  }) => Promise<QuickBooksInvoice[]>;
  getQuickBooksInvoice?: (args: {
    environment: "sandbox" | "production";
    realmId: string;
    accessToken: string;
    invoiceId: string;
  }) => Promise<QuickBooksInvoice>;
}

export type QuickBooksPreviewResult =
  | {
    state: "available";
    preview: {
      companyInfo: ProbeQuickBooksAccountingResult["companyInfo"];
      recentCustomers: QuickBooksCustomer[];
      recentInvoices: QuickBooksInvoice[];
      featuredInvoice: QuickBooksInvoice | null;
      loadedAt: string;
    };
  }
  | { state: "unavailable" }
  | { state: "error"; error: string };

export async function loadQuickBooksPreview(
  deps: QuickBooksPreviewDeps = {},
): Promise<QuickBooksPreviewResult> {
  const record = await prisma.integrationCredential.findUnique({
    where: { integrationId: INTEGRATION_ID },
  });

  if (!record?.fieldsEnc) {
    return { state: "unavailable" };
  }

  const fields = decryptJson<StoredQuickBooksFields>(record.fieldsEnc);
  if (!isConfigured(fields)) {
    return { state: "unavailable" };
  }

  const exchange = deps.exchangeRefreshToken ?? exchangeRefreshToken;
  const probe = deps.probeQuickBooksAccounting ?? probeQuickBooksAccounting;
  const listCustomers = deps.listQuickBooksCustomers ?? listQuickBooksCustomers;
  const listInvoices = deps.listQuickBooksInvoices ?? listQuickBooksInvoices;
  const getInvoice = deps.getQuickBooksInvoice ?? getQuickBooksInvoice;

  try {
    const token = await exchange({
      clientId: fields.clientId,
      clientSecret: fields.clientSecret,
      refreshToken: fields.refreshToken,
    });

    const probeResult = await probe({
      environment: fields.environment,
      realmId: fields.realmId,
      accessToken: token.accessToken,
    });
    const recentCustomers = await listCustomers({
      environment: fields.environment,
      realmId: fields.realmId,
      accessToken: token.accessToken,
      limit: 5,
    });
    const recentInvoices = await listInvoices({
      environment: fields.environment,
      realmId: fields.realmId,
      accessToken: token.accessToken,
      limit: 5,
    });
    const featuredInvoice =
      typeof recentInvoices[0]?.Id === "string"
        ? await getInvoice({
          environment: fields.environment,
          realmId: fields.realmId,
          accessToken: token.accessToken,
          invoiceId: recentInvoices[0].Id,
        })
        : null;

    const now = new Date();
    const companyName =
      typeof probeResult.companyInfo.CompanyName === "string"
        ? probeResult.companyInfo.CompanyName
        : fields.companyName ?? null;

    await prisma.integrationCredential.update({
      where: { integrationId: INTEGRATION_ID },
      data: {
        status: "connected",
        fieldsEnc: encryptJson({
          ...fields,
          refreshToken: token.refreshToken,
          companyName,
        }),
        tokenCacheEnc: encryptJson({
          accessToken: token.accessToken,
          refreshToken: token.refreshToken,
          tokenType: token.tokenType,
          expiresAt: token.expiresAt.toISOString(),
        }),
        lastTestedAt: now,
        lastErrorAt: null,
        lastErrorMsg: null,
      },
    });

    return {
      state: "available",
      preview: {
        companyInfo: probeResult.companyInfo,
        recentCustomers,
        recentInvoices,
        featuredInvoice,
        loadedAt: now.toISOString(),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "QuickBooks preview failed";
    const now = new Date();

    await prisma.integrationCredential.update({
      where: { integrationId: INTEGRATION_ID },
      data: {
        status: "error",
        lastErrorAt: now,
        lastErrorMsg: message,
      },
    });

    return {
      state: "error",
      error: message,
    };
  }
}

function isConfigured(fields: StoredQuickBooksFields | null): fields is {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  realmId: string;
  environment: "sandbox" | "production";
  companyName?: string | null;
} {
  return Boolean(
    fields &&
      typeof fields.clientId === "string" &&
      typeof fields.clientSecret === "string" &&
      typeof fields.refreshToken === "string" &&
      typeof fields.realmId === "string" &&
      (fields.environment === "sandbox" || fields.environment === "production"),
  );
}
