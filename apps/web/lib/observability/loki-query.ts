// EP-FULL-OBS Tier 2 (BI-5FE8656F) — server-side Loki query helper.
//
// Thin wrapper over Loki's query_range HTTP API. The portal reaches Loki by
// its Docker-network DNS name (loki:3100) — same as it reaches Prometheus. No
// browser access (CORS / network isolation); this runs server-side only.

import type { RawLogLine } from "@/lib/observability/log-signature";

const DEFAULT_LOKI_URL = process.env.LOKI_URL || "http://loki:3100";
// Whole-word-ish error filter pushed down to Loki to bound the result set.
// Fine-grained filtering (info/debug exclusion, substring guards) happens in
// log-signature.isErrorLine — this is just a cheap server-side prefilter.
const ERROR_FILTER = "(?i)(error|fatal|panic|exception|traceback)";

export interface LokiQueryOptions {
  lookbackMinutes: number;
  lokiUrl?: string;
  limit?: number;
  /** Injectable clock for deterministic tests. */
  nowMs?: number;
  timeoutMs?: number;
}

interface LokiStream {
  stream?: Record<string, string>;
  values?: [string, string][];
}

/** Query Loki for error/warn lines across all dpf containers in the window. */
export async function queryLokiErrorLines(opts: LokiQueryOptions): Promise<RawLogLine[]> {
  const lokiUrl = opts.lokiUrl ?? DEFAULT_LOKI_URL;
  const now = opts.nowMs ?? Date.now();
  const startNs = String((now - opts.lookbackMinutes * 60_000) * 1_000_000);
  const endNs = String(now * 1_000_000);

  const url = new URL("/loki/api/v1/query_range", lokiUrl);
  url.searchParams.set("query", `{compose_project="dpf"} |~ "${ERROR_FILTER}"`);
  url.searchParams.set("start", startNs);
  url.searchParams.set("end", endNs);
  url.searchParams.set("limit", String(opts.limit ?? 5000));
  url.searchParams.set("direction", "forward");

  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
  });
  if (!res.ok) {
    throw new Error(`Loki query failed: ${res.status} ${await res.text().catch(() => "")}`);
  }

  const data = (await res.json()) as { data?: { result?: LokiStream[] } };
  const out: RawLogLine[] = [];
  for (const stream of data?.data?.result ?? []) {
    const service = stream.stream?.service || stream.stream?.container || "unknown";
    for (const [tsNs, line] of stream.values ?? []) {
      out.push({ service, line, tsMs: Math.floor(Number(tsNs) / 1e6) });
    }
  }
  return out;
}
