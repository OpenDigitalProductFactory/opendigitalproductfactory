import { request, type Dispatcher } from "undici";

export type QuickBooksEnvironment = "sandbox" | "production";

export interface ProbeQuickBooksAccountingParams {
  environment: QuickBooksEnvironment;
  realmId: string;
  accessToken: string;
  dispatcher?: Dispatcher;
}

export interface QuickBooksCompanyInfo {
  CompanyName?: string;
  Country?: string;
  [key: string]: unknown;
}

export interface QuickBooksCustomer {
  Id?: string;
  DisplayName?: string;
  CompanyName?: string;
  [key: string]: unknown;
}

export interface QuickBooksInvoice {
  Id?: string;
  DocNumber?: string;
  TotalAmt?: number;
  Balance?: number;
  CustomerRef?: {
    value?: string;
    name?: string;
    [key: string]: unknown;
  };
  PrivateNote?: string;
  [key: string]: unknown;
}

export interface ProbeQuickBooksAccountingResult {
  companyInfo: QuickBooksCompanyInfo;
  sampleCustomer: QuickBooksCustomer | null;
  sampleInvoice: QuickBooksInvoice | null;
}

export class QuickBooksAccountingError extends Error {
  readonly statusCode: number | undefined;

  constructor(message: string, opts?: { statusCode?: number }) {
    super(message);
    this.name = "QuickBooksAccountingError";
    this.statusCode = opts?.statusCode;
  }
}

export function resolveAccountingBaseUrl(environment: QuickBooksEnvironment): string {
  if (process.env.QUICKBOOKS_API_BASE_URL) {
    return process.env.QUICKBOOKS_API_BASE_URL;
  }
  return environment === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

export async function probeQuickBooksAccounting(
  params: ProbeQuickBooksAccountingParams,
): Promise<ProbeQuickBooksAccountingResult> {
  const baseUrl = resolveAccountingBaseUrl(params.environment);
  const companyInfo = await fetchJson<CompanyInfoResponse>(
    `${baseUrl}/v3/company/${params.realmId}/companyinfo/${params.realmId}`,
    params,
  );
  const sampleCustomer = await queryEntity<QuickBooksCustomer>("Customer", params, baseUrl);
  const sampleInvoice = await queryEntity<QuickBooksInvoice>("Invoice", params, baseUrl);

  return {
    companyInfo: companyInfo.CompanyInfo,
    sampleCustomer,
    sampleInvoice,
  };
}

export async function listQuickBooksCustomers(
  params: ProbeQuickBooksAccountingParams & { limit?: number },
): Promise<QuickBooksCustomer[]> {
  return queryEntities<QuickBooksCustomer>("Customer", params, resolveAccountingBaseUrl(params.environment), params.limit);
}

export async function listQuickBooksInvoices(
  params: ProbeQuickBooksAccountingParams & { limit?: number },
): Promise<QuickBooksInvoice[]> {
  return queryEntities<QuickBooksInvoice>("Invoice", params, resolveAccountingBaseUrl(params.environment), params.limit);
}

export async function getQuickBooksInvoice(
  params: ProbeQuickBooksAccountingParams & { invoiceId: string },
): Promise<QuickBooksInvoice> {
  const baseUrl = resolveAccountingBaseUrl(params.environment);
  const response = await fetchJson<InvoiceResponse>(
    `${baseUrl}/v3/company/${params.realmId}/invoice/${params.invoiceId}`,
    params,
  );
  return response.Invoice;
}

async function queryEntity<T extends Record<string, unknown>>(
  entity: "Customer" | "Invoice",
  params: ProbeQuickBooksAccountingParams,
  baseUrl: string,
): Promise<T | null> {
  const results = await queryEntities<T>(entity, params, baseUrl, 1);
  return results[0] ?? null;
}

async function queryEntities<T extends Record<string, unknown>>(
  entity: "Customer" | "Invoice",
  params: ProbeQuickBooksAccountingParams,
  baseUrl: string,
  limit = 5,
): Promise<T[]> {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(Math.trunc(limit), 25)) : 5;
  const query = new URLSearchParams({
    query: `select * from ${entity} maxresults ${safeLimit}`,
  }).toString();
  const response = await fetchJson<QueryResponse<T>>(
    `${baseUrl}/v3/company/${params.realmId}/query?${query}`,
    params,
  );

  const results = response.QueryResponse?.[entity];
  return Array.isArray(results) ? results : [];
}

async function fetchJson<T>(
  url: string,
  params: ProbeQuickBooksAccountingParams,
): Promise<T> {
  let response: Dispatcher.ResponseData;
  try {
    response = await request(url, {
      method: "GET",
      dispatcher: params.dispatcher,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${params.accessToken}`,
      },
    });
  } catch {
    throw new QuickBooksAccountingError("QuickBooks accounting probe failed — check network reachability and try again.");
  }

  if (response.statusCode === 401 || response.statusCode === 403) {
    await safelyDrainBody(response.body);
    throw new QuickBooksAccountingError("QuickBooks accounting probe was unauthorized", {
      statusCode: response.statusCode,
    });
  }

  if (response.statusCode >= 500) {
    await safelyDrainBody(response.body);
    throw new QuickBooksAccountingError("QuickBooks accounting API returned a server error — retry later.", {
      statusCode: response.statusCode,
    });
  }

  if (response.statusCode !== 200) {
    await safelyDrainBody(response.body);
    throw new QuickBooksAccountingError(`QuickBooks accounting probe failed with status ${response.statusCode}`, {
      statusCode: response.statusCode,
    });
  }

  try {
    return await response.body.json() as T;
  } catch {
    throw new QuickBooksAccountingError("QuickBooks accounting response was not valid JSON", {
      statusCode: response.statusCode,
    });
  }
}

interface CompanyInfoResponse {
  CompanyInfo: QuickBooksCompanyInfo;
}

interface InvoiceResponse {
  Invoice: QuickBooksInvoice;
}

type QueryResponse<T extends Record<string, unknown>> = {
  QueryResponse?: {
    Customer?: T[];
    Invoice?: T[];
  };
};

async function safelyDrainBody(body: { text: () => Promise<string> }): Promise<void> {
  try {
    await body.text();
  } catch {
    // ignore
  }
}
