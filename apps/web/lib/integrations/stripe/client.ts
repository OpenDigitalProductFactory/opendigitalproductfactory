import { request, type Dispatcher } from "undici";

export interface StripeBalanceAmount {
  amount?: number;
  currency?: string;
  [key: string]: unknown;
}

export interface StripeBalance {
  livemode?: boolean;
  available?: StripeBalanceAmount[];
  pending?: StripeBalanceAmount[];
  [key: string]: unknown;
}

export interface StripeCustomer {
  id?: string;
  name?: string;
  email?: string;
  [key: string]: unknown;
}

export interface StripeInvoice {
  id?: string;
  number?: string;
  status?: string;
  amount_due?: number;
  currency?: string;
  [key: string]: unknown;
}

export interface StripePaymentIntent {
  id?: string;
  amount?: number;
  currency?: string;
  status?: string;
  description?: string;
  [key: string]: unknown;
}

export interface StripeProbeResult {
  balance: StripeBalance;
  recentCustomers: StripeCustomer[];
  recentInvoices: StripeInvoice[];
  recentPaymentIntents: StripePaymentIntent[];
}

interface StripeRequestParams {
  secretKey: string;
  dispatcher?: Dispatcher;
}

export class StripeApiError extends Error {
  readonly statusCode: number | undefined;

  constructor(message: string, opts?: { statusCode?: number }) {
    super(message);
    this.name = "StripeApiError";
    this.statusCode = opts?.statusCode;
  }
}

export function resolveStripeApiBaseUrl(): string {
  return process.env.STRIPE_API_BASE_URL ?? "https://api.stripe.com";
}

export async function probeStripeAccount(
  params: StripeRequestParams,
): Promise<StripeProbeResult> {
  const [balance, recentCustomers, recentInvoices, recentPaymentIntents] = await Promise.all([
    fetchStripeJson<StripeBalance>("/v1/balance", params),
    listStripeCustomers({ ...params, limit: 5 }),
    listStripeInvoices({ ...params, limit: 5 }),
    listStripePaymentIntents({ ...params, limit: 5 }),
  ]);

  return {
    balance,
    recentCustomers,
    recentInvoices,
    recentPaymentIntents,
  };
}

export async function listStripeCustomers(
  params: StripeRequestParams & { limit?: number },
): Promise<StripeCustomer[]> {
  const response = await fetchStripeJson<StripeListResponse<StripeCustomer>>(
    `/v1/customers?limit=${normalizeLimit(params.limit)}`,
    params,
  );
  return Array.isArray(response.data) ? response.data : [];
}

export async function listStripeInvoices(
  params: StripeRequestParams & { limit?: number },
): Promise<StripeInvoice[]> {
  const response = await fetchStripeJson<StripeListResponse<StripeInvoice>>(
    `/v1/invoices?limit=${normalizeLimit(params.limit)}`,
    params,
  );
  return Array.isArray(response.data) ? response.data : [];
}

export async function listStripePaymentIntents(
  params: StripeRequestParams & { limit?: number },
): Promise<StripePaymentIntent[]> {
  const response = await fetchStripeJson<StripeListResponse<StripePaymentIntent>>(
    `/v1/payment_intents?limit=${normalizeLimit(params.limit)}`,
    params,
  );
  return Array.isArray(response.data) ? response.data : [];
}

async function fetchStripeJson<T>(
  path: string,
  params: StripeRequestParams,
): Promise<T> {
  let response: Dispatcher.ResponseData;
  try {
    response = await request(`${resolveStripeApiBaseUrl()}${path}`, {
      method: "GET",
      dispatcher: params.dispatcher,
      headers: {
        accept: "application/json",
        authorization: stripeAuthorization(params.secretKey),
      },
    });
  } catch {
    throw new StripeApiError("Stripe API request failed — check network reachability and try again.");
  }

  if (response.statusCode === 401 || response.statusCode === 403) {
    await safelyDrainBody(response.body);
    throw new StripeApiError("invalid Stripe credentials", { statusCode: response.statusCode });
  }

  if (response.statusCode >= 500) {
    await safelyDrainBody(response.body);
    throw new StripeApiError("Stripe API returned a server error — retry later.", {
      statusCode: response.statusCode,
    });
  }

  if (response.statusCode !== 200) {
    await safelyDrainBody(response.body);
    throw new StripeApiError(`Stripe API request failed with status ${response.statusCode}`, {
      statusCode: response.statusCode,
    });
  }

  try {
    return await response.body.json() as T;
  } catch {
    throw new StripeApiError("Stripe API response was not valid JSON", {
      statusCode: response.statusCode,
    });
  }
}

function stripeAuthorization(secretKey: string): string {
  return `Basic ${Buffer.from(`${secretKey}:`, "utf8").toString("base64")}`;
}

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return 5;
  return Math.max(1, Math.min(Math.trunc(limit as number), 100));
}

type StripeListResponse<T> = {
  object?: string;
  data?: T[];
};

async function safelyDrainBody(body: { text: () => Promise<string> }): Promise<void> {
  try {
    await body.text();
  } catch {
    // ignore
  }
}
