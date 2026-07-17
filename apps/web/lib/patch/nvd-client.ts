import type { AdvisoryInput, PatchSeverity } from "@dpf/db/patch";

import { getErrorMessage } from "@/lib/shared/get-error-message";

const NVD_BASE = process.env.NVD_API_BASE ?? "https://services.nvd.nist.gov";
const NVD_KEY = process.env.NVD_API_KEY;
const TIMEOUT_MS = Number(process.env.NVD_TIMEOUT_MS ?? 20000);
const NVD_WINDOW_MS = 30_000;
const ANON_LIMIT = 5;
const KEYED_LIMIT = 50;

export interface NvdRateLimiter {
  wait(): Promise<void>;
}

export interface NvdRateLimiterOptions {
  hasApiKey?: boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export function createNvdRateLimiter(options: NvdRateLimiterOptions = {}): NvdRateLimiter {
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const limit = options.hasApiKey ? KEYED_LIMIT : ANON_LIMIT;
  const timestamps: number[] = [];

  return {
    async wait(): Promise<void> {
      let current = now();
      while (timestamps.length > 0 && current - timestamps[0] >= NVD_WINDOW_MS) timestamps.shift();
      if (timestamps.length >= limit) {
        const waitMs = Math.max(0, NVD_WINDOW_MS - (current - timestamps[0]));
        await sleep(waitMs);
        current = now();
        while (timestamps.length > 0 && current - timestamps[0] >= NVD_WINDOW_MS) timestamps.shift();
      }
      timestamps.push(current);
    },
  };
}

const defaultLimiter = createNvdRateLimiter({ hasApiKey: Boolean(NVD_KEY) });

type NvdMetric = { cvssData?: { baseSeverity?: string }; baseSeverity?: string };
type NvdCve = {
  id?: string;
  metrics?: {
    cvssMetricV40?: NvdMetric[];
    cvssMetricV31?: NvdMetric[];
    cvssMetricV30?: NvdMetric[];
    cvssMetricV2?: NvdMetric[];
  };
};

export interface FetchNvdCveOptions {
  fetcher?: typeof fetch;
  kevCves: ReadonlySet<string>;
  rateLimiter?: NvdRateLimiter;
  sleep?: (ms: number) => Promise<void>;
}

function severityFromNvd(value: string | null | undefined): PatchSeverity | null {
  switch ((value ?? "").toLowerCase()) {
    case "critical":
      return "critical";
    case "high":
      return "high";
    case "medium":
      return "medium";
    case "low":
      return "low";
    default:
      return null;
  }
}

function metricSeverity(cve: NvdCve): PatchSeverity | null {
  const metrics = cve.metrics;
  const candidates = [
    ...(metrics?.cvssMetricV40 ?? []),
    ...(metrics?.cvssMetricV31 ?? []),
    ...(metrics?.cvssMetricV30 ?? []),
    ...(metrics?.cvssMetricV2 ?? []),
  ];
  for (const metric of candidates) {
    const severity = severityFromNvd(metric.cvssData?.baseSeverity ?? metric.baseSeverity);
    if (severity) return severity;
  }
  return null;
}

async function fetchWithTimeout(url: string, fetcher: typeof fetch, headers: HeadersInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetcher(url, { signal: controller.signal, headers });
  } finally {
    clearTimeout(timer);
  }
}

function retryAfterMs(res: Response): number {
  const retryAfter = res.headers.get("retry-after");
  const seconds = retryAfter ? Number(retryAfter) : 0;
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : NVD_WINDOW_MS;
}

function advisoryFromCve(cve: NvdCve | undefined, kevCves: ReadonlySet<string>): AdvisoryInput | null {
  const id = cve?.id;
  if (!id) return null;
  return {
    id,
    severity: metricSeverity(cve ?? {}) ?? "high",
    fixedVersion: null,
    cisaKev: kevCves.has(id),
    source: "nvd",
    findingKind: "patch-gap",
  };
}

export async function fetchNvdCveAdvisories(
  cpeName: string,
  options: FetchNvdCveOptions,
): Promise<AdvisoryInput[]> {
  const fetcher = options.fetcher ?? fetch;
  const limiter = options.rateLimiter ?? defaultLimiter;
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const headers: HeadersInit = NVD_KEY ? { apiKey: NVD_KEY } : {};
  const advisories: AdvisoryInput[] = [];
  const pageSize = 2000;
  let startIndex = 0;

  for (;;) {
    const params = new URLSearchParams({
      cpeName,
      resultsPerPage: String(pageSize),
      startIndex: String(startIndex),
    });
    const url = `${NVD_BASE}/rest/json/cves/2.0?${params.toString()}&isVulnerable`;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await limiter.wait();
      try {
        const res = await fetchWithTimeout(url, fetcher, headers);
        if (res.status === 429 && attempt === 0) {
          await sleep(retryAfterMs(res));
          continue;
        }
        if (!res.ok) return advisories;
        const json = (await res.json()) as {
          resultsPerPage?: number;
          startIndex?: number;
          totalResults?: number;
          vulnerabilities?: Array<{ cve?: NvdCve }>;
        };
        advisories.push(
          ...(json.vulnerabilities ?? [])
            .map((entry) => advisoryFromCve(entry.cve, options.kevCves))
            .filter((advisory): advisory is AdvisoryInput => advisory !== null),
        );

        const returned = json.resultsPerPage ?? (json.vulnerabilities ?? []).length;
        const total = json.totalResults ?? advisories.length;
        const nextStartIndex = (json.startIndex ?? startIndex) + returned;
        if (returned <= 0 || nextStartIndex >= total) return advisories;
        startIndex = nextStartIndex;
        break;
      } catch (err) {
        console.warn("[nvd-client] CVE lookup failed", getErrorMessage(err));
        return advisories;
      }
    }
  }
}
