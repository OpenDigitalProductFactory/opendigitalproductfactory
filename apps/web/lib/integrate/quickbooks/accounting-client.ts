import { request, type Dispatcher } from "undici";

export type QuickBooksEnvironment = "sandbox" | "production";

export interface ProbeQuickBooksAccountingParams {
  environment: QuickBooksEnvironment;
  realmId: string;
  accessToken: string;
  dispatcher?: Dispatcher;
}

export interface QuickBooksCompanyInfo {
  Id?: string;
  CompanyName?: string;
  Country?: string;
  MetaData?: QuickBooksRecordMetaData;
  [key: string]: unknown;
}

export interface QuickBooksCustomer {
  Id?: string;
  DisplayName?: string;
  CompanyName?: string;
  MetaData?: QuickBooksRecordMetaData;
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
  MetaData?: QuickBooksRecordMetaData;
  [key: string]: unknown;
}

export interface QuickBooksVendor {
  Id?: string;
  DisplayName?: string;
  CompanyName?: string;
  PrimaryEmailAddr?: {
    Address?: string;
    [key: string]: unknown;
  };
  MetaData?: QuickBooksRecordMetaData;
  [key: string]: unknown;
}

export interface QuickBooksBill {
  Id?: string;
  DocNumber?: string;
  TotalAmt?: number;
  Balance?: number;
  VendorRef?: {
    value?: string;
    name?: string;
    [key: string]: unknown;
  };
  DueDate?: string;
  MetaData?: QuickBooksRecordMetaData;
  [key: string]: unknown;
}

export interface QuickBooksExpense {
  Id?: string;
  TotalAmt?: number;
  PaymentType?: string;
  AccountRef?: {
    value?: string;
    name?: string;
    [key: string]: unknown;
  };
  EntityRef?: {
    value?: string;
    name?: string;
    type?: string;
    [key: string]: unknown;
  };
  MetaData?: QuickBooksRecordMetaData;
  [key: string]: unknown;
}

export interface QuickBooksPayment {
  Id?: string;
  TotalAmt?: number;
  CustomerRef?: {
    value?: string;
    name?: string;
    [key: string]: unknown;
  };
  MetaData?: QuickBooksRecordMetaData;
  [key: string]: unknown;
}

export interface QuickBooksAccount {
  Id?: string;
  Name?: string;
  AccountType?: string;
  AccountSubType?: string;
  CurrentBalance?: number;
  MetaData?: QuickBooksRecordMetaData;
  [key: string]: unknown;
}

export type QuickBooksReportName =
  | "ProfitAndLoss"
  | "BalanceSheet"
  | "CashFlow"
  | "AgedReceivables"
  | "AgedPayables";

export interface QuickBooksReport {
  Header?: {
    ReportName?: string;
    Time?: string;
    StartPeriod?: string;
    EndPeriod?: string;
    [key: string]: unknown;
  };
  Rows?: Record<string, unknown>;
  Columns?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface QuickBooksRecordMetaData {
  CreateTime?: string;
  LastUpdatedTime?: string;
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
  return queryEntities<QuickBooksCustomer>(
    "Customer",
    params,
    resolveAccountingBaseUrl(params.environment),
    params.limit,
  );
}

export async function listQuickBooksInvoices(
  params: ProbeQuickBooksAccountingParams & { limit?: number },
): Promise<QuickBooksInvoice[]> {
  return queryEntities<QuickBooksInvoice>(
    "Invoice",
    params,
    resolveAccountingBaseUrl(params.environment),
    params.limit,
  );
}

export async function listQuickBooksVendors(
  params: ProbeQuickBooksAccountingParams & { limit?: number },
): Promise<QuickBooksVendor[]> {
  return queryEntities<QuickBooksVendor>(
    "Vendor",
    params,
    resolveAccountingBaseUrl(params.environment),
    params.limit,
  );
}

export async function listQuickBooksBills(
  params: ProbeQuickBooksAccountingParams & { limit?: number },
): Promise<QuickBooksBill[]> {
  return queryEntities<QuickBooksBill>(
    "Bill",
    params,
    resolveAccountingBaseUrl(params.environment),
    params.limit,
  );
}

export async function listQuickBooksExpenses(
  params: ProbeQuickBooksAccountingParams & { limit?: number },
): Promise<QuickBooksExpense[]> {
  return queryEntities<QuickBooksExpense>(
    "Purchase",
    params,
    resolveAccountingBaseUrl(params.environment),
    params.limit,
  );
}

export async function listQuickBooksPayments(
  params: ProbeQuickBooksAccountingParams & { limit?: number },
): Promise<QuickBooksPayment[]> {
  return queryEntities<QuickBooksPayment>(
    "Payment",
    params,
    resolveAccountingBaseUrl(params.environment),
    params.limit,
  );
}

export async function listQuickBooksAccounts(
  params: ProbeQuickBooksAccountingParams & { limit?: number },
): Promise<QuickBooksAccount[]> {
  return queryEntities<QuickBooksAccount>(
    "Account",
    params,
    resolveAccountingBaseUrl(params.environment),
    params.limit,
  );
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

export async function getQuickBooksReport(
  params: ProbeQuickBooksAccountingParams & { reportName: QuickBooksReportName },
): Promise<QuickBooksReport> {
  const baseUrl = resolveAccountingBaseUrl(params.environment);
  const reportName = encodeURIComponent(params.reportName);
  return fetchJson<QuickBooksReport>(
    `${baseUrl}/v3/company/${params.realmId}/reports/${reportName}`,
    params,
  );
}

type QuickBooksQueryableEntity =
  | "Customer"
  | "Invoice"
  | "Vendor"
  | "Bill"
  | "Purchase"
  | "Payment"
  | "Account";

async function queryEntity<T extends Record<string, unknown>>(
  entity: QuickBooksQueryableEntity,
  params: ProbeQuickBooksAccountingParams,
  baseUrl: string,
): Promise<T | null> {
  const results = await queryEntities<T>(entity, params, baseUrl, 1);
  return results[0] ?? null;
}

async function queryEntities<T extends Record<string, unknown>>(
  entity: QuickBooksQueryableEntity,
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
    throw new QuickBooksAccountingError(
      "QuickBooks accounting probe failed — check network reachability and try again.",
    );
  }

  if (response.statusCode === 401 || response.statusCode === 403) {
    await safelyDrainBody(response.body);
    throw new QuickBooksAccountingError("QuickBooks accounting probe was unauthorized", {
      statusCode: response.statusCode,
    });
  }

  if (response.statusCode >= 500) {
    await safelyDrainBody(response.body);
    throw new QuickBooksAccountingError(
      "QuickBooks accounting API returned a server error — retry later.",
      {
        statusCode: response.statusCode,
      },
    );
  }

  if (response.statusCode !== 200) {
    await safelyDrainBody(response.body);
    throw new QuickBooksAccountingError(
      `QuickBooks accounting probe failed with status ${response.statusCode}`,
      {
        statusCode: response.statusCode,
      },
    );
  }

  try {
    return (await response.body.json()) as T;
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
    [entity in QuickBooksQueryableEntity]?: T[];
  } & Record<string, unknown>;
};

async function safelyDrainBody(body: { text: () => Promise<string> }): Promise<void> {
  try {
    await body.text();
  } catch {
    // ignore
  }
}
