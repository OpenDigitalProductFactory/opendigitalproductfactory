import { request, type Dispatcher } from "undici";

export interface HubSpotAccountDetails {
  portalId?: number;
  accountType?: string;
  companyCurrency?: string;
  dataHostingLocation?: string;
  timeZone?: string;
  uiDomain?: string;
  additionalCurrencies?: string[];
  utcOffset?: string;
  utcOffsetMilliseconds?: number;
  [key: string]: unknown;
}

export interface HubSpotContactRecord {
  id?: string;
  properties?: Record<string, string | null | undefined>;
  [key: string]: unknown;
}

export interface HubSpotFormRecord {
  guid?: string;
  name?: string;
  formType?: string;
  createdAt?: number | string;
  [key: string]: unknown;
}

export interface HubSpotProbeResult {
  account: HubSpotAccountDetails;
  recentContacts: HubSpotContactRecord[];
  recentForms: HubSpotFormRecord[];
}

interface HubSpotRequestParams {
  accessToken: string;
  dispatcher?: Dispatcher;
}

export class HubSpotApiError extends Error {
  readonly statusCode: number | undefined;

  constructor(message: string, opts?: { statusCode?: number }) {
    super(message);
    this.name = "HubSpotApiError";
    this.statusCode = opts?.statusCode;
  }
}

export function resolveHubSpotApiBaseUrl(): string {
  return process.env.HUBSPOT_API_BASE_URL ?? "https://api.hubapi.com";
}

export async function probeHubSpotPortal(
  params: HubSpotRequestParams,
): Promise<HubSpotProbeResult> {
  const [account, recentContacts, recentForms] = await Promise.all([
    fetchHubSpotJson<HubSpotAccountDetails>("/account-info/2026-03/details", params),
    listHubSpotContacts({ ...params, limit: 5 }),
    listHubSpotForms({ ...params, limit: 5 }),
  ]);

  return {
    account,
    recentContacts,
    recentForms,
  };
}

export async function listHubSpotContacts(
  params: HubSpotRequestParams & { limit?: number },
): Promise<HubSpotContactRecord[]> {
  const query = new URLSearchParams({
    limit: String(normalizeLimit(params.limit)),
    properties: "firstname,lastname,email,lifecyclestage,createdate",
  }).toString();
  const response = await fetchHubSpotJson<{ results?: HubSpotContactRecord[] }>(
    `/crm/v3/objects/contacts?${query}`,
    params,
  );
  return Array.isArray(response.results) ? response.results : [];
}

export async function listHubSpotForms(
  params: HubSpotRequestParams & { limit?: number },
): Promise<HubSpotFormRecord[]> {
  const response = await fetchHubSpotJson<HubSpotFormRecord[]>("/forms/v2/forms", params);
  const forms = Array.isArray(response) ? response : [];
  return forms.slice(0, normalizeLimit(params.limit));
}

async function fetchHubSpotJson<T>(
  path: string,
  params: HubSpotRequestParams,
): Promise<T> {
  let response: Dispatcher.ResponseData;
  try {
    response = await request(`${resolveHubSpotApiBaseUrl()}${path}`, {
      method: "GET",
      dispatcher: params.dispatcher,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${params.accessToken}`,
      },
    });
  } catch {
    throw new HubSpotApiError("HubSpot API request failed — check network reachability and try again.");
  }

  if (response.statusCode === 401 || response.statusCode === 403) {
    await safelyDrainBody(response.body);
    throw new HubSpotApiError("invalid HubSpot credentials", {
      statusCode: response.statusCode,
    });
  }

  if (response.statusCode >= 500) {
    await safelyDrainBody(response.body);
    throw new HubSpotApiError("HubSpot API returned a server error — retry later.", {
      statusCode: response.statusCode,
    });
  }

  if (response.statusCode !== 200) {
    await safelyDrainBody(response.body);
    throw new HubSpotApiError(`HubSpot API request failed with status ${response.statusCode}`, {
      statusCode: response.statusCode,
    });
  }

  try {
    return await response.body.json() as T;
  } catch {
    throw new HubSpotApiError("HubSpot API response was not valid JSON", {
      statusCode: response.statusCode,
    });
  }
}

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return 5;
  return Math.max(1, Math.min(Math.trunc(limit as number), 100));
}

async function safelyDrainBody(body: { text: () => Promise<string> }): Promise<void> {
  try {
    await body.text();
  } catch {
    // ignore
  }
}
