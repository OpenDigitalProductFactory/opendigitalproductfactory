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
  [key: string]: unknown;
}

export interface QuickBooksInvoice {
  Id?: string;
  DocNumber?: string;
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

async function queryEntity<T extends Record<string, unknown>>(
  entity: "Customer" | "Invoice",
  params: ProbeQuickBooksAccountingParams,
  baseUrl: string,
): Promise<T | null> {
  const query = new URLSearchParams({
    query: `select * from ${entity} maxresults 1`,
  }).toString();
  const response = await fetchJson<QueryResponse<T>>(
    `${baseUrl}/v3/company/${params.realmId}/query?${query}`,
    params,
  );

  const results = response.QueryResponse?.[entity];
  return Array.isArray(results) && results.length > 0 ? results[0]! : null;
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
