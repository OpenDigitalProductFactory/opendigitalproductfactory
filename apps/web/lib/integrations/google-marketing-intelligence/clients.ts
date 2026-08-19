import { request, type Dispatcher } from "undici";

export interface GoogleAnalyticsSummary {
  sessions: number;
  totalUsers: number;
  conversions: number;
}

export interface GoogleSearchConsoleRow {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
  [key: string]: unknown;
}

export interface GoogleMarketingProbeResult {
  analyticsSummary: GoogleAnalyticsSummary;
  searchConsoleRows: GoogleSearchConsoleRow[];
}

interface GoogleMarketingRequestParams {
  accessToken: string;
  ga4PropertyId: string;
  searchConsoleSiteUrl: string;
  dispatcher?: Dispatcher;
}

export class GoogleAnalyticsApiError extends Error {
  readonly statusCode: number | undefined;

  constructor(message: string, opts?: { statusCode?: number }) {
    super(message);
    this.name = "GoogleAnalyticsApiError";
    this.statusCode = opts?.statusCode;
  }
}

export class GoogleSearchConsoleApiError extends Error {
  readonly statusCode: number | undefined;

  constructor(message: string, opts?: { statusCode?: number }) {
    super(message);
    this.name = "GoogleSearchConsoleApiError";
    this.statusCode = opts?.statusCode;
  }
}

export function resolveGoogleAnalyticsApiBaseUrl(): string {
  return process.env.GOOGLE_ANALYTICS_API_BASE_URL ?? "https://analyticsdata.googleapis.com";
}

export function resolveGoogleSearchConsoleApiBaseUrl(): string {
  return process.env.GOOGLE_SEARCH_CONSOLE_API_BASE_URL ?? "https://searchconsole.googleapis.com";
}

export async function probeGoogleMarketingIntelligence(
  params: GoogleMarketingRequestParams,
): Promise<GoogleMarketingProbeResult> {
  const [analyticsSummary, searchConsoleRows] = await Promise.all([
    runGa4SummaryReport(params),
    querySearchConsole(params),
  ]);

  return {
    analyticsSummary,
    searchConsoleRows,
  };
}

async function runGa4SummaryReport(
  params: GoogleMarketingRequestParams,
): Promise<GoogleAnalyticsSummary> {
  const url = `${resolveGoogleAnalyticsApiBaseUrl()}/v1beta/properties/${params.ga4PropertyId}:runReport`;

  let response: Dispatcher.ResponseData;
  try {
    response = await request(url, {
      method: "POST",
      dispatcher: params.dispatcher,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${params.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        dimensions: [{ name: "date" }],
        metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "conversions" }],
        dateRanges: [{ startDate: "28daysAgo", endDate: "today" }],
        limit: 1,
      }),
    });
  } catch {
    throw new GoogleAnalyticsApiError(
      "Google Analytics API request failed — check network reachability and try again.",
    );
  }

  if (response.statusCode === 401 || response.statusCode === 403) {
    await safelyDrainBody(response.body);
    throw new GoogleAnalyticsApiError("invalid Google Analytics permissions", {
      statusCode: response.statusCode,
    });
  }

  if (response.statusCode !== 200) {
    await safelyDrainBody(response.body);
    throw new GoogleAnalyticsApiError(
      `Google Analytics API request failed with status ${response.statusCode}`,
      { statusCode: response.statusCode },
    );
  }

  const payload = await response.body.json() as {
    rows?: Array<{
      metricValues?: Array<{ value?: string }>;
    }>;
  };

  const row = payload.rows?.[0];
  return {
    sessions: toNumber(row?.metricValues?.[0]?.value),
    totalUsers: toNumber(row?.metricValues?.[1]?.value),
    conversions: toNumber(row?.metricValues?.[2]?.value),
  };
}

async function querySearchConsole(
  params: GoogleMarketingRequestParams,
): Promise<GoogleSearchConsoleRow[]> {
  const encodedSite = encodeURIComponent(params.searchConsoleSiteUrl);
  const url = `${resolveGoogleSearchConsoleApiBaseUrl()}/webmasters/v3/sites/${encodedSite}/searchAnalytics/query`;

  let response: Dispatcher.ResponseData;
  try {
    response = await request(url, {
      method: "POST",
      dispatcher: params.dispatcher,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${params.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        startDate: "2026-03-27",
        endDate: "2026-04-24",
        dimensions: ["page", "query"],
        rowLimit: 5,
      }),
    });
  } catch {
    throw new GoogleSearchConsoleApiError(
      "Google Search Console API request failed — check network reachability and try again.",
    );
  }

  if (response.statusCode === 401 || response.statusCode === 403) {
    await safelyDrainBody(response.body);
    throw new GoogleSearchConsoleApiError("invalid Google Search Console permissions", {
      statusCode: response.statusCode,
    });
  }

  if (response.statusCode !== 200) {
    await safelyDrainBody(response.body);
    throw new GoogleSearchConsoleApiError(
      `Google Search Console API request failed with status ${response.statusCode}`,
      { statusCode: response.statusCode },
    );
  }

  const payload = await response.body.json() as {
    rows?: GoogleSearchConsoleRow[];
  };

  return Array.isArray(payload.rows) ? payload.rows : [];
}

function toNumber(value: string | undefined): number {
  if (typeof value !== "string") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function safelyDrainBody(body: { text: () => Promise<string> }): Promise<void> {
  try {
    await body.text();
  } catch {
    // ignore
  }
}
