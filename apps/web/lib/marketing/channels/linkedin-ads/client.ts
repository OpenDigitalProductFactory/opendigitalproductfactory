// LinkedIn Ads — thin HTTP client.
//
// Phase 4 surface — minimum viable ad placement:
//   POST /v2/adCampaignsV2  — create a campaign with daily/lifetime budget.
//   GET  /v2/adAnalyticsV2  — pull engagement (impressions/clicks/cost).
//
// Creative + audience targeting are passed pre-formed via draft metadata.
// We don't try to build LinkedIn's targeting DSL in Phase 4 — the operator
// (or a future agent) constructs the URN and we honor it.

export const LINKEDIN_ADS_CAMPAIGNS_URL = "https://api.linkedin.com/v2/adCampaignsV2";
export const LINKEDIN_ADS_ANALYTICS_URL = "https://api.linkedin.com/v2/adAnalyticsV2";

export const LINKEDIN_ADS_REQUIRED_SCOPES = [
  "openid",
  "profile",
  "email",
  "w_member_social", // shared with Phase 2 personal posting
  "r_ads",
  "rw_ads",
] as const;

export type FetchImpl = (
  url: string,
  init: RequestInit,
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}>;

const defaultFetch: FetchImpl = (url, init) =>
  fetch(url, init) as ReturnType<FetchImpl>;

export type PlaceCampaignInput = {
  adAccountUrn: string;       // "urn:li:sponsoredAccount:1234567"
  audienceUrn: string;        // "urn:li:adTargetingFacet:..." or saved audience URN
  creativeBody: string;       // body text of the ad creative
  dailyBudgetCents: number;   // hard per-day cap; LinkedIn uses USD micros under the hood
  totalBudgetCents?: number;  // optional lifetime cap
  campaignName: string;
};

export type PlaceCampaignResult =
  | { ok: true; campaignUrn: string; createdAt: string }
  | { ok: false; status: number; error: string; retryable: boolean };

export async function placeCampaign(
  accessToken: string,
  input: PlaceCampaignInput,
  fetchImpl: FetchImpl = defaultFetch,
): Promise<PlaceCampaignResult> {
  // LinkedIn Ads budgets use micro-units. 1 USD = 1_000_000 micros.
  const dailyBudgetMicros = Math.round((input.dailyBudgetCents / 100) * 1_000_000);
  const payload: Record<string, unknown> = {
    account: input.adAccountUrn,
    name: input.campaignName,
    status: "ACTIVE",
    type: "SPONSORED_UPDATES",
    costType: "CPC",
    dailyBudget: { amount: String(dailyBudgetMicros), currencyCode: "USD" },
    runSchedule: { start: Date.now() },
    targetingCriteria: { include: { and: [{ or: { "urn:li:adTargetingFacet:audienceMatchingSegments": [input.audienceUrn] } }] } },
    creativeSelection: "OPTIMIZED",
  };
  if (input.totalBudgetCents) {
    const totalMicros = Math.round((input.totalBudgetCents / 100) * 1_000_000);
    payload.totalBudget = { amount: String(totalMicros), currencyCode: "USD" };
  }

  const res = await fetchImpl(LINKEDIN_ADS_CAMPAIGNS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify(payload),
  });

  if (res.ok) {
    const json = (await res.json()) as { id?: string | number; createdAt?: string };
    if (!json.id) {
      return { ok: false, status: 200, error: "no_campaign_id_in_response", retryable: false };
    }
    const campaignUrn = `urn:li:sponsoredCampaign:${json.id}`;
    return { ok: true, campaignUrn, createdAt: json.createdAt ?? new Date().toISOString() };
  }

  const text = await res.text().catch(() => "");
  const retryable = res.status === 429 || res.status >= 500;
  const errorTag =
    res.status === 401 ? "linkedin_ads_auth_failed"
    : res.status === 403 ? "linkedin_ads_insufficient_scope"
    : res.status === 429 ? "linkedin_ads_rate_limited"
    : `linkedin_ads_http_${res.status}`;
  return { ok: false, status: res.status, error: `${errorTag}: ${text.slice(0, 200)}`, retryable };
}

export type CampaignAnalyticsSnapshot = {
  campaignUrn: string;
  impressions: number;
  clicks: number;
  costInUsdCents: number;
  conversions: number;
  raw: unknown;
};

export async function fetchCampaignAnalytics(
  accessToken: string,
  campaignUrn: string,
  fetchImpl: FetchImpl = defaultFetch,
): Promise<CampaignAnalyticsSnapshot | { error: string; status: number }> {
  const url = `${LINKEDIN_ADS_ANALYTICS_URL}?q=analytics&pivot=CAMPAIGN&campaigns=List(${encodeURIComponent(campaignUrn)})&timeGranularity=ALL`;
  const res = await fetchImpl(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
    },
  });
  if (!res.ok) {
    return { error: `analytics_${res.status}`, status: res.status };
  }
  const json = (await res.json()) as { elements?: Array<Record<string, unknown>> };
  const element = json.elements?.[0] ?? {};
  return {
    campaignUrn,
    impressions: numberOr(element["impressions"], 0),
    clicks: numberOr(element["clicks"], 0),
    costInUsdCents: Math.round(numberOr(element["costInUsd"], 0) * 100),
    conversions: numberOr(element["externalWebsiteConversions"], 0),
    raw: element,
  };
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
