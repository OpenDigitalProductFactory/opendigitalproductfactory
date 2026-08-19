// Greenhouse Harvest API client.
//
// Auth is HTTP Basic with the Harvest API key as the username and an empty
// password: `Authorization: Basic base64("<token>:")`.
// Base URL: https://harvest.greenhouse.io/v1/  (Greenhouse has no separate
// sandbox host — a sandbox is just a distinct Greenhouse account/key.)
//
// This module currently carries the connect-time credential check. The full
// paged readers (jobs/candidates/applications/stages/scorecards/offers) land in
// BI-B65B8C11 and extend this same file.

export const HARVEST_BASE_URL = "https://harvest.greenhouse.io/v1";

/** Injectable fetch so callers/tests can supply their own implementation. */
export type HarvestFetch = typeof fetch;

/** Build the Harvest HTTP Basic auth header: base64("<token>:"). */
export function harvestAuthHeader(apiToken: string): string {
  return `Basic ${Buffer.from(`${apiToken}:`, "utf8").toString("base64")}`;
}

export interface HarvestCredentialCheck {
  ok: boolean;
  status: number;
}

/**
 * Cheap connect-time probe: list one job. A 2xx means the key authenticates and
 * has at least read access; 401/403 means bad key or insufficient permission.
 * Never returns the response body (it may carry candidate PII).
 */
export async function verifyHarvestCredential(
  apiToken: string,
  fetchImpl: HarvestFetch = fetch,
): Promise<HarvestCredentialCheck> {
  const res = await fetchImpl(`${HARVEST_BASE_URL}/jobs?per_page=1`, {
    method: "GET",
    headers: { Authorization: harvestAuthHeader(apiToken) },
  });
  return { ok: res.ok, status: res.status };
}

export class HarvestApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HarvestApiError";
  }
}

/** Extract the `rel="next"` URL from an RFC-5988 Link header, or null. */
export function parseHarvestNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

export interface HarvestPageOptions {
  apiToken: string;
  fetchImpl?: HarvestFetch;
  /** Items per page (Harvest max 500). */
  perPage?: number;
  /** Safety cap on pages walked, so a runaway pipeline can't page forever. */
  maxPages?: number;
  /** Injectable sleep so tests don't wait on real Retry-After backoff. */
  sleepImpl?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Walk a Harvest collection via `Link: rel="next"` pagination, honoring `429`
 * with a bounded `Retry-After` backoff. Never returns partial pages silently:
 * a non-2xx (other than 429) throws HarvestApiError.
 */
export async function harvestGetPaged<T = unknown>(
  path: string,
  opts: HarvestPageOptions,
): Promise<T[]> {
  const { apiToken, fetchImpl = fetch, perPage = 100, maxPages = 50, sleepImpl = defaultSleep } = opts;
  const results: T[] = [];
  const separator = path.includes("?") ? "&" : "?";
  let url: string | null = `${HARVEST_BASE_URL}${path}${separator}per_page=${perPage}`;
  let pages = 0;
  let retriesLeft = 5;

  while (url && pages < maxPages) {
    const res = await fetchImpl(url, { headers: { Authorization: harvestAuthHeader(apiToken) } });

    if (res.status === 429) {
      if (retriesLeft-- <= 0) {
        throw new HarvestApiError(429, `Harvest ${path} rate-limited — retries exhausted`);
      }
      const retryAfter = res.headers.get("retry-after");
      const seconds = retryAfter == null ? 1 : Math.max(0, Number(retryAfter) || 0);
      await sleepImpl(seconds * 1000);
      continue; // retry same url
    }

    if (!res.ok) {
      throw new HarvestApiError(res.status, `Harvest ${path} returned ${res.status}`);
    }

    const page = (await res.json()) as T[];
    results.push(...page);
    url = parseHarvestNextLink(res.headers.get("link"));
    pages += 1;
  }

  return results;
}
