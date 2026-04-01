// apps/web/lib/metrics.ts
// Prometheus metrics registry for platform operational health monitoring.
// Scraped by Prometheus at /api/metrics when the monitoring profile is active.

import {
  Registry,
  Counter,
  Histogram,
  Gauge,
  collectDefaultMetrics,
} from "prom-client";

export const metricsRegistry = new Registry();

// Node.js runtime metrics (heap, GC, event loop lag, active handles)
collectDefaultMetrics({ register: metricsRegistry, prefix: "dpf_" });

// ─── HTTP Request Metrics ───────────────────────────────────────────────────

export const httpRequestDuration = new Histogram({
  name: "dpf_http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
});

export const httpRequestsTotal = new Counter({
  name: "dpf_http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["method", "route", "status_code"] as const,
  registers: [metricsRegistry],
});

// ─── AI Inference Metrics ───────────────────────────────────────────────────

export const aiInferenceDuration = new Histogram({
  name: "dpf_ai_inference_duration_seconds",
  help: "AI inference call duration in seconds",
  labelNames: ["provider", "model", "agent"] as const,
  buckets: [0.5, 1, 2.5, 5, 10, 20, 30, 60, 120],
  registers: [metricsRegistry],
});

export const aiInferenceTokens = new Counter({
  name: "dpf_ai_inference_tokens_total",
  help: "Total tokens consumed by AI inference",
  labelNames: ["provider", "model", "direction"] as const,
  registers: [metricsRegistry],
});

export const aiInferenceErrors = new Counter({
  name: "dpf_ai_inference_errors_total",
  help: "Total AI inference errors",
  labelNames: ["provider", "error_type"] as const,
  registers: [metricsRegistry],
});

export const aiInferenceCostUsd = new Counter({
  name: "dpf_ai_inference_cost_usd_total",
  help: "Cumulative AI inference cost in USD",
  labelNames: ["provider"] as const,
  registers: [metricsRegistry],
});

// ─── Semantic Memory Metrics ────────────────────────────────────────────────

export const semanticMemoryOps = new Counter({
  name: "dpf_semantic_memory_ops_total",
  help: "Semantic memory operations",
  labelNames: ["operation", "status"] as const,
  registers: [metricsRegistry],
});

export const semanticMemoryErrors = new Counter({
  name: "dpf_semantic_memory_errors_total",
  help: "Semantic memory operation errors",
  labelNames: ["operation"] as const,
  registers: [metricsRegistry],
});

export const semanticMemoryLatency = new Histogram({
  name: "dpf_semantic_memory_duration_seconds",
  help: "Semantic memory operation duration",
  labelNames: ["operation"] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2],
  registers: [metricsRegistry],
});

// ─── Sandbox Metrics ────────────────────────────────────────────────────────

export const sandboxBuildsActive = new Gauge({
  name: "dpf_sandbox_builds_active",
  help: "Number of active sandbox builds",
  registers: [metricsRegistry],
});

export const sandboxBuildDuration = new Histogram({
  name: "dpf_sandbox_build_duration_seconds",
  help: "Sandbox build duration",
  labelNames: ["phase"] as const,
  buckets: [10, 30, 60, 120, 300, 600, 1800],
  registers: [metricsRegistry],
});

// ─── Database Connection Metrics ────────────────────────────────────────────

export const dbQueryDuration = new Histogram({
  name: "dpf_db_query_duration_seconds",
  help: "Database query duration",
  labelNames: ["operation"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [metricsRegistry],
});

export const dbQueryErrors = new Counter({
  name: "dpf_db_query_errors_total",
  help: "Database query errors",
  labelNames: ["operation"] as const,
  registers: [metricsRegistry],
});

// ─── Process Observer Metrics ───────────────────────────────────────────────

export const observerFindings = new Counter({
  name: "dpf_observer_findings_total",
  help: "Process observer findings by type and severity",
  labelNames: ["type", "severity"] as const,
  registers: [metricsRegistry],
});
