import type { CollectorContext, CollectorOutput } from "../discovery-types";

// ─── Prometheus Job Classification ─────────────────────────────────────────
// Maps Prometheus scrape job names to discovery item types and confidence levels.
// Known platform jobs get high confidence (rule-based attribution will auto-promote).
// Unknown jobs get low confidence and route to the exception queue.

const JOB_CLASSIFICATION: Record<string, { itemType: string; confidence: number }> = {
  postgres: { itemType: "database", confidence: 0.95 },
  "postgres-exporter": { itemType: "monitoring_service", confidence: 0.95 },
  neo4j: { itemType: "database", confidence: 0.95 },
  qdrant: { itemType: "database", confidence: 0.95 },
  portal: { itemType: "application", confidence: 0.95 },
  sandbox: { itemType: "application", confidence: 0.90 },
  "model-runner": { itemType: "ai_service", confidence: 0.95 },
  cadvisor: { itemType: "monitoring_service", confidence: 0.95 },
  "node-exporter": { itemType: "monitoring_service", confidence: 0.95 },
  prometheus: { itemType: "monitoring_service", confidence: 0.95 },
};

const DEFAULT_CLASSIFICATION = { itemType: "service", confidence: 0.5 };

export function classifyPrometheusJob(job: string): { itemType: string; confidence: number } {
  return JOB_CLASSIFICATION[job] ?? DEFAULT_CLASSIFICATION;
}

// ─── Dependency Injection Types ────────────────────────────────────────────

type PrometheusDeps = {
  fetchFn: typeof fetch;
  prometheusUrl: string;
};

type PrometheusTarget = {
  labels: { job: string; instance: string; [key: string]: string };
  health: "up" | "down" | "unknown";
  scrapePool: string;
  lastScrape: string;
};

// ─── Collector ─────────────────────────────────────────────────────────────

export async function collectPrometheusDiscovery(
  ctx?: CollectorContext,
  deps?: Partial<PrometheusDeps>,
): Promise<CollectorOutput> {
  const fetchFn = deps?.fetchFn ?? globalThis.fetch;
  const prometheusUrl = deps?.prometheusUrl ?? process.env.PROMETHEUS_URL ?? "http://prometheus:9090";
  const source = ctx?.sourceKind ?? "prometheus";

  let targets: PrometheusTarget[];
  try {
    const res = await fetchFn(`${prometheusUrl}/api/v1/targets`, {
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) {
      return { items: [], relationships: [], warnings: ["prometheus_unreachable"] };
    }
    const json = await res.json() as { data?: { activeTargets?: PrometheusTarget[] } };
    targets = json.data?.activeTargets ?? [];
  } catch {
    return { items: [], relationships: [], warnings: ["prometheus_unreachable"] };
  }

  if (targets.length === 0) {
    return { items: [], relationships: [], warnings: ["prometheus_no_targets"] };
  }

  const items: CollectorOutput["items"] = [];
  const relationships: CollectorOutput["relationships"] = [];

  // Track prometheus self-target for monitors relationships
  let prometheusSelfRef: string | null = null;

  for (const target of targets) {
    const { job, instance } = target.labels;
    if (!job || !instance) continue;

    const classification = classifyPrometheusJob(job);
    const externalRef = `prom-target:${job}:${instance}`;
    const naturalKey = `prom:${job}:${instance}`;

    items.push({
      sourceKind: source,
      itemType: classification.itemType,
      name: job,
      externalRef,
      naturalKey,
      confidence: classification.confidence,
      attributes: {
        job,
        instance,
        health: target.health,
        scrapePool: target.scrapePool,
      },
    });

    if (job === "prometheus") {
      prometheusSelfRef = externalRef;
    }
  }

  // Prometheus monitors all other targets
  if (prometheusSelfRef) {
    for (const item of items) {
      if (item.externalRef === prometheusSelfRef) continue;
      relationships.push({
        sourceKind: source,
        relationshipType: "monitors",
        fromExternalRef: prometheusSelfRef,
        toExternalRef: item.externalRef,
        confidence: 0.95,
        attributes: { mechanism: "scrape" },
      });
    }
  }

  return { items, relationships };
}
