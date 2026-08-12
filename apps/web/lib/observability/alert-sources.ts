// EP-FULL-OBS Tier 2 (BI-5FE8656F item #6) — unified firing-alert source.
//
// The platform runs TWO alert evaluators that each expose a Prometheus-shaped
// alerts API but neither pushes anywhere (there is no Alertmanager, by design —
// "minimize entirely new processes"):
//
//   - Prometheus    GET  {PROMETHEUS_URL}/api/v1/alerts            (metric rules)
//   - Loki ruler    GET  {LOKI_URL}/prometheus/api/v1/alerts       (log-rate rules)
//
// This helper reads BOTH and returns one normalized list plus per-source
// reachability. It is the single source consumed by:
//   - the live display endpoint  (/api/platform/metrics/alerts)  → health dot
//   - the persistence cron        (alert-delivery-bridge)         → PortfolioQualityIssue
//
// Reading aggregated alert state (not raw log lines) is what makes the whole
// path storm-proof: a container flooding 10k lines/sec still produces exactly
// ONE ContainerErrorLogStorm alert here, never a per-line flood.

const PROMETHEUS_URL = process.env.PROMETHEUS_URL || "http://prometheus:9090";
const LOKI_URL = process.env.LOKI_URL || "http://loki:3100";
const DEFAULT_TIMEOUT_MS = 4_000;

/**
 * True iff a Prometheus scrape endpoint is explicitly configured for this
 * install. The module falls back to the in-cluster hostname
 * `http://prometheus:9090`, which does not resolve on a fresh/local topology
 * that ships no monitoring stack — so the fallback must NOT be read as
 * "configured". Only an explicit PROMETHEUS_URL counts. (BI-63FF58D2)
 */
export function isPrometheusConfigured(): boolean {
  return Boolean(process.env.PROMETHEUS_URL?.trim());
}

/**
 * True iff ANY monitoring backend (Prometheus metrics or the Loki log ruler) is
 * explicitly configured. Drives the "not configured" vs "offline" distinction
 * in the operator health chrome: an install with no monitoring target shows a
 * neutral "not configured" state, never an alarming "offline" one. (BI-63FF58D2)
 */
export function isMonitoringConfigured(): boolean {
  return isPrometheusConfigured() || Boolean(process.env.LOKI_URL?.trim());
}

export type AlertSourceSystem = "prometheus" | "loki-ruler";

/**
 * Prometheus-compatible alert shape, shared by both evaluators. Structurally a
 * superset of the frontend's MonitoringAlert (health-summary.ts), so the
 * display route can hand these straight to the client — the extra
 * `sourceSystem`/`value` fields are ignored there and used by the cron for
 * source-attributed reconciliation.
 */
export interface PlatformAlert {
  labels: Record<string, string>;
  annotations: Record<string, string>;
  state: "firing" | "pending" | "inactive" | string;
  activeAt?: string;
  value?: string;
  /** Which evaluator surfaced this alert — drives reconciliation ownership. */
  sourceSystem: AlertSourceSystem;
}

export interface AlertSourcesResult {
  alerts: PlatformAlert[];
  /** True iff the source responded this cycle. False = unreachable; its alerts
   *  are absent from `alerts` and the caller MUST NOT treat that as "resolved". */
  reached: Record<AlertSourceSystem, boolean>;
}

export interface FetchAlertSourcesOptions {
  prometheusUrl?: string;
  lokiUrl?: string;
  timeoutMs?: number;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

interface RawPromAlert {
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  state?: string;
  activeAt?: string;
  value?: string;
}

async function fetchOneSource(
  url: string,
  sourceSystem: AlertSourceSystem,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<{ alerts: PlatformAlert[]; reached: boolean }> {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { alerts: [], reached: false };
    const json = (await res.json()) as { status?: string; data?: { alerts?: RawPromAlert[] } };
    if (json.status && json.status !== "success") return { alerts: [], reached: false };
    const alerts: PlatformAlert[] = (json.data?.alerts ?? []).map((a) => ({
      labels: a.labels ?? {},
      annotations: a.annotations ?? {},
      state: a.state ?? "firing",
      activeAt: a.activeAt,
      value: a.value,
      sourceSystem,
    }));
    return { alerts, reached: true };
  } catch {
    // Timeout / connection refused / bad JSON — source unreachable this cycle.
    return { alerts: [], reached: false };
  }
}

/**
 * Read firing/pending alerts from Prometheus and the Loki ruler in parallel.
 * Each source is independent: one being down never suppresses the other, and a
 * down source is reported via `reached` so callers don't false-resolve its
 * issues.
 */
export async function fetchAlertSources(
  opts: FetchAlertSourcesOptions = {},
): Promise<AlertSourcesResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const promUrl = `${opts.prometheusUrl ?? PROMETHEUS_URL}/api/v1/alerts`;
  const lokiUrl = `${opts.lokiUrl ?? LOKI_URL}/prometheus/api/v1/alerts`;

  const [prom, loki] = await Promise.all([
    fetchOneSource(promUrl, "prometheus", fetchImpl, timeoutMs),
    fetchOneSource(lokiUrl, "loki-ruler", fetchImpl, timeoutMs),
  ]);

  return {
    alerts: [...prom.alerts, ...loki.alerts],
    reached: { prometheus: prom.reached, "loki-ruler": loki.reached },
  };
}
