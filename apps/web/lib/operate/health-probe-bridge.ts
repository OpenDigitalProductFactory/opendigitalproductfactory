// apps/web/lib/health-probe-bridge.ts
// Bridge between Prometheus metrics and HealthProbe/HealthSnapshot models.
// Queries Prometheus HTTP API and writes HealthSnapshot records so the
// Operations Console (EP-FOUND-OPS) can render Prometheus-sourced data.
//
// NOTE: This module is ready to wire up once the HealthProbe and HealthSnapshot
// schema models from EP-FOUND-OPS are migrated into the database.
// Until then, it serves as the reference implementation for the bridge logic.

const PROMETHEUS_URL = process.env.PROMETHEUS_URL || "http://prometheus:9090";

// ─── Prometheus Query Helpers ────────────────────────────────────────────────

type PrometheusResult = {
  metric: Record<string, string>;
  value: [number, string];
};

async function queryPrometheus(promql: string): Promise<PrometheusResult[] | null> {
  try {
    const url = `${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(promql)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return null;
    const json = await res.json();
    if (json.status !== "success") return null;
    return json.data?.result ?? [];
  } catch {
    return null;
  }
}

// ─── Probe Type Query Mapping ────────────────────────────────────────────────

type ProbeMetrics = {
  status: "healthy" | "warning" | "critical" | "unreachable" | "unknown";
  metrics: Record<string, number | boolean | string>;
  message: string | null;
};

export async function collectContainerMetrics(containerName: string): Promise<ProbeMetrics> {
  const [cpuResult, memResult] = await Promise.all([
    queryPrometheus(`rate(container_cpu_usage_seconds_total{name="${containerName}"}[5m]) * 100`),
    queryPrometheus(`container_memory_usage_bytes{name="${containerName}"}`),
  ]);

  if (cpuResult === null && memResult === null) {
    return { status: "unreachable", metrics: {}, message: "Prometheus unreachable" };
  }

  const cpuPct = cpuResult?.[0]?.value?.[1] ? parseFloat(cpuResult[0].value[1]) : null;
  const memBytes = memResult?.[0]?.value?.[1] ? parseFloat(memResult[0].value[1]) : null;

  const metrics: Record<string, number | boolean | string> = {};
  if (cpuPct !== null) metrics.cpu_pct = cpuPct;
  if (memBytes !== null) metrics.mem_bytes = memBytes;

  // Status derivation (default thresholds, overridable by probe config)
  let status: ProbeMetrics["status"] = "healthy";
  if (cpuPct !== null && cpuPct >= 90) status = "critical";
  else if (cpuPct !== null && cpuPct >= 70) status = "warning";
  if (memBytes !== null && memBytes === 0) status = "unreachable";

  return { status, metrics, message: null };
}

export async function collectDatabaseMetrics(dbType: "postgres" | "qdrant"): Promise<ProbeMetrics> {
  if (dbType === "postgres") {
    const [upResult, connResult, maxResult] = await Promise.all([
      queryPrometheus("pg_up"),
      queryPrometheus("pg_stat_activity_count"),
      queryPrometheus("pg_settings_max_connections"),
    ]);

    if (upResult === null) {
      return { status: "unreachable", metrics: {}, message: "Prometheus unreachable" };
    }

    const isUp = parseFloat(upResult?.[0]?.value?.[1] ?? "0") === 1;
    if (!isUp) {
      return { status: "critical", metrics: { accepting_connections: false }, message: "PostgreSQL is down" };
    }

    const activeConns = parseFloat(connResult?.[0]?.value?.[1] ?? "0");
    const maxConns = parseFloat(maxResult?.[0]?.value?.[1] ?? "100");
    const utilPct = (activeConns / maxConns) * 100;

    const metrics = {
      accepting_connections: true,
      active_connections: activeConns,
      max_connections: maxConns,
      utilization_pct: utilPct,
    };

    let status: ProbeMetrics["status"] = "healthy";
    if (utilPct >= 90) status = "critical";
    else if (utilPct >= 80) status = "warning";

    return { status, metrics, message: null };
  }

  // Qdrant — check both reachability and collection health
  const upResult = await queryPrometheus('up{job="qdrant"}');
  if (upResult === null) {
    return { status: "unreachable", metrics: {}, message: "Prometheus unreachable" };
  }
  const isUp = parseFloat(upResult?.[0]?.value?.[1] ?? "0") === 1;
  if (!isUp) {
    return { status: "critical", metrics: { reachable: false }, message: "Qdrant vector DB is unreachable" };
  }

  // Check collection existence and point counts
  const qdrantUrl = process.env.QDRANT_INTERNAL_URL ?? process.env.QDRANT_URL ?? "http://localhost:6333";
  let agentMemoryPoints = 0;
  let collectionsExist = false;
  try {
    const res = await fetch(`${qdrantUrl}/collections/agent-memory`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      collectionsExist = true;
      const data = await res.json() as { result?: { points_count?: number } };
      agentMemoryPoints = data.result?.points_count ?? 0;
    }
  } catch { /* non-fatal */ }

  const metrics: Record<string, number | boolean | string> = {
    reachable: true,
    collections_exist: collectionsExist,
    agent_memory_points: agentMemoryPoints,
  };

  return {
    status: collectionsExist ? "healthy" : "warning",
    metrics,
    message: collectionsExist ? null : "Qdrant reachable but memory collections not initialized — semantic memory is not storing data",
  };
}

export async function collectServiceMetrics(job: string): Promise<ProbeMetrics> {
  const upResult = await queryPrometheus(`up{job="${job}"}`);
  if (upResult === null) {
    return { status: "unknown", metrics: {}, message: "Monitoring stack offline" };
  }
  const isUp = parseFloat(upResult?.[0]?.value?.[1] ?? "0") === 1;
  return {
    status: isUp ? "healthy" : "critical",
    metrics: { reachable: isUp },
    message: isUp ? null : `Service ${job} is unreachable`,
  };
}

// ─── Bridge Runner ──────────────────────────────────────────────────────────
// Called by the scheduled job system when HealthProbe/HealthSnapshot models exist.

export type BridgeResult = {
  probeKey: string;
  probeType: string;
  result: ProbeMetrics;
};

export async function runHealthProbeBridge(): Promise<BridgeResult[]> {
  const results: BridgeResult[] = [];

  // Container probes
  const containers = [
    "dpf-portal-1",
    "dpf-postgres-1",
    "dpf-neo4j-1",
    "dpf-qdrant-1",
    "dpf-sandbox-1",
    "dpf-sandbox-2-1",
    "dpf-sandbox-3-1",
  ];
  for (const name of containers) {
    const result = await collectContainerMetrics(name);
    results.push({ probeKey: `container-${name}`, probeType: "container", result });
  }

  // Database probes
  results.push({
    probeKey: "database-postgres",
    probeType: "database",
    result: await collectDatabaseMetrics("postgres"),
  });
  results.push({
    probeKey: "database-qdrant",
    probeType: "database",
    result: await collectDatabaseMetrics("qdrant"),
  });

  // Service probes
  for (const job of ["portal", "model-runner", "neo4j"]) {
    results.push({
      probeKey: `service-${job}`,
      probeType: "service",
      result: await collectServiceMetrics(job),
    });
  }

  return results;
}

// ─── API endpoint for manual bridge trigger ──────────────────────────────────
// Can be called from the Operations Console or a scheduled job.

export async function triggerBridge(): Promise<{
  success: boolean;
  results: BridgeResult[];
  error?: string;
}> {
  try {
    const results = await runHealthProbeBridge();
    // TODO: When HealthProbe/HealthSnapshot schema models are available,
    // write HealthSnapshot records here:
    //   for (const r of results) {
    //     const probe = await prisma.healthProbe.findUnique({ where: { probeKey: r.probeKey } });
    //     if (probe) {
    //       await prisma.healthSnapshot.create({
    //         data: {
    //           probeId: probe.id,
    //           status: r.result.status,
    //           metrics: r.result.metrics,
    //           message: r.result.message,
    //         },
    //       });
    //     }
    //   }
    return { success: true, results };
  } catch (err) {
    return {
      success: false,
      results: [],
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
