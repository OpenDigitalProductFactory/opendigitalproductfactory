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

export const aiCacheCreationTokens = new Counter({
  name: "dpf_ai_cache_creation_tokens_total",
  help: "Tokens written into the Anthropic prompt cache (billed at cache-write rate)",
  labelNames: ["provider", "model"] as const,
  registers: [metricsRegistry],
});

export const aiCacheReadTokens = new Counter({
  name: "dpf_ai_cache_read_tokens_total",
  help: "Tokens read from the Anthropic prompt cache (billed at cache-read rate)",
  labelNames: ["provider", "model"] as const,
  registers: [metricsRegistry],
});

export const buildPhaseCostUsd = new Counter({
  name: "dpf_build_phase_cost_usd_total",
  help: "Estimated USD cost per Build Studio phase (from token usage × model pricing)",
  labelNames: ["phase", "agent"] as const,
  registers: [metricsRegistry],
});

export const threadCompactionTotal = new Counter({
  name: "dpf_thread_compaction_total",
  help: "Number of rolling thread compaction cycles fired across all coworker threads",
  labelNames: ["route"] as const,
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

// ─── EP-INF-UTIL-001: Utility Inference Metrics ────────────────────────────

export const utilityInferenceOps = new Counter({
  name: "dpf_utility_inference_ops_total",
  help: "Utility inference operations by task, status, and provider",
  labelNames: ["task", "status", "provider"] as const,
  registers: [metricsRegistry],
});

export const utilityInferenceLatency = new Histogram({
  name: "dpf_utility_inference_duration_seconds",
  help: "Utility inference latency by task and provider",
  labelNames: ["task", "provider"] as const,
  buckets: [0.5, 1, 2, 5, 10],
  registers: [metricsRegistry],
});

// ─── Runtime kernel-commandment gate (BI-43F95F77) ─────────────────────────
// Spec: docs/superpowers/specs/2026-05-24-runtime-kernel-commandments.md §5.5
//
// Emitted by both the /api/kernel/gate route (shell-guard requests) and the
// MCP dispatcher integration in lib/mcp-tools.ts. Labels let us see which
// commandments fire most often and how often interactive vs autonomous
// sessions hit confirms vs refuses.

export const kernelGateDecisionsTotal = new Counter({
  name: "dpf_kernel_gate_decisions_total",
  help: "Runtime kernel-commandment gate decisions, labelled by verdict + principle slug + session class.",
  labelNames: ["verdict", "principle_slug", "session_class"] as const,
  registers: [metricsRegistry],
});

// ─── Postgres Daily Backup (Slice 1) ───────────────────────────────────────
// Spec: docs/superpowers/specs/2026-05-17-postgres-daily-backup-design.md §8

export const postgresBackupRunsTotal = new Counter({
  name: "dpf_postgres_backup_runs_total",
  help: "Postgres backup runs by status and trigger",
  labelNames: ["status", "trigger"] as const,
  registers: [metricsRegistry],
});

export const postgresBackupLastSuccessSeconds = new Gauge({
  name: "dpf_postgres_backup_last_success_seconds",
  help: "Epoch seconds at which the last successful Postgres backup finished",
  registers: [metricsRegistry],
});

export const postgresBackupStorageBytes = new Gauge({
  name: "dpf_postgres_backup_storage_bytes",
  help: "Total bytes used by retained Postgres backup dumps",
  registers: [metricsRegistry],
});

export const postgresBackupDurationSeconds = new Histogram({
  name: "dpf_postgres_backup_duration_seconds",
  help: "Wall-clock duration of Postgres backup runs",
  labelNames: ["trigger"] as const,
  buckets: [1, 2, 5, 10, 30, 60, 300, 900],
  registers: [metricsRegistry],
});

// ─── Postgres Restore (Slice 2) ────────────────────────────────────────────
// Spec: docs/superpowers/specs/2026-05-17-postgres-daily-backup-design.md §4.6

export const postgresRestoreRunsTotal = new Counter({
  name: "dpf_postgres_restore_runs_total",
  help: "Postgres restore runs by status (ok | failed)",
  labelNames: ["status"] as const,
  registers: [metricsRegistry],
});

export const postgresRestoreDurationSeconds = new Histogram({
  name: "dpf_postgres_restore_duration_seconds",
  help: "Wall-clock duration of Postgres restore runs (includes pre-restore safety dump)",
  buckets: [5, 10, 30, 60, 120, 300, 600, 1800],
  registers: [metricsRegistry],
});

// ─── Postgres Trial-Restore Verification (BI-31C9FBDF) ─────────────────────
// Nightly automated trial-restore that proves backups are functionally
// restorable WITHOUT touching the production DB.

export const postgresTrialRestoreRunsTotal = new Counter({
  name: "dpf_postgres_trial_restore_runs_total",
  help: "Postgres trial-restore verification runs by status (ok | failed). Failed = pg_restore failed OR a critical-table row-count assertion failed.",
  labelNames: ["status"] as const,
  registers: [metricsRegistry],
});

export const postgresTrialRestoreLastSuccessSeconds = new Gauge({
  name: "dpf_postgres_trial_restore_last_success_seconds",
  help: "Epoch seconds at which the last successful Postgres trial-restore verification finished. Stale value = silent backup corruption risk.",
  registers: [metricsRegistry],
});

export const postgresTrialRestoreDurationSeconds = new Histogram({
  name: "dpf_postgres_trial_restore_duration_seconds",
  help: "Wall-clock duration of Postgres trial-restore runs",
  buckets: [5, 10, 30, 60, 120, 300, 600, 1800],
  registers: [metricsRegistry],
});

// ─── Neo4j Daily Backup (Slice 3) ─────────────────────────────────────────────
// Spec: docs/superpowers/specs/2026-05-18-postgres-backup-slice-3-neo4j-qdrant.md

export const neo4jBackupRunsTotal = new Counter({
  name: "dpf_neo4j_backup_runs_total",
  help: "Neo4j backup runs by status and trigger",
  labelNames: ["status", "trigger"] as const,
  registers: [metricsRegistry],
});

export const neo4jBackupLastSuccessSeconds = new Gauge({
  name: "dpf_neo4j_backup_last_success_seconds",
  help: "Epoch seconds at which the last successful Neo4j backup finished",
  registers: [metricsRegistry],
});

export const neo4jBackupStorageBytes = new Gauge({
  name: "dpf_neo4j_backup_storage_bytes",
  help: "Total bytes used by retained Neo4j backup dumps",
  registers: [metricsRegistry],
});

export const neo4jBackupDurationSeconds = new Histogram({
  name: "dpf_neo4j_backup_duration_seconds",
  help: "Wall-clock duration of Neo4j backup runs",
  labelNames: ["trigger"] as const,
  buckets: [1, 2, 5, 10, 30, 60, 300, 900],
  registers: [metricsRegistry],
});

// ─── Qdrant Daily Backup (Slice 3) ────────────────────────────────────────────
// Spec: docs/superpowers/specs/2026-05-18-postgres-backup-slice-3-neo4j-qdrant.md

export const qdrantBackupRunsTotal = new Counter({
  name: "dpf_qdrant_backup_runs_total",
  help: "Qdrant backup runs by status and trigger",
  labelNames: ["status", "trigger"] as const,
  registers: [metricsRegistry],
});

export const qdrantBackupLastSuccessSeconds = new Gauge({
  name: "dpf_qdrant_backup_last_success_seconds",
  help: "Epoch seconds at which the last successful Qdrant backup finished",
  registers: [metricsRegistry],
});

export const qdrantBackupStorageBytes = new Gauge({
  name: "dpf_qdrant_backup_storage_bytes",
  help: "Total bytes used by retained Qdrant backup snapshots",
  registers: [metricsRegistry],
});

export const qdrantBackupDurationSeconds = new Histogram({
  name: "dpf_qdrant_backup_duration_seconds",
  help: "Wall-clock duration of Qdrant backup runs",
  labelNames: ["trigger"] as const,
  buckets: [1, 2, 5, 10, 30, 60, 300, 900],
  registers: [metricsRegistry],
});

// ─── Voice STT (speech-to-text adapter call) ──────────────────────────────
// The hwdsl2/whisper-server image we ship doesn't expose a Prometheus
// /metrics endpoint, so the only place we can observe its health is from
// the caller side. Lives on the portal's /api/metrics surface; the Health
// tab's "Voice STT" tile reads from these instead of from a direct scrape.

export const voiceSttDuration = new Histogram({
  name: "dpf_voice_stt_duration_seconds",
  help: "Voice STT transcription call duration in seconds, by provider and model",
  labelNames: ["provider", "model"] as const,
  buckets: [0.5, 1, 2.5, 5, 10, 20, 30, 60, 120],
  registers: [metricsRegistry],
});

export const voiceSttCallsTotal = new Counter({
  name: "dpf_voice_stt_calls_total",
  help: "Voice STT transcription calls by outcome (ok | error) and provider",
  labelNames: ["provider", "model", "outcome"] as const,
  registers: [metricsRegistry],
});

export const voiceSttErrors = new Counter({
  name: "dpf_voice_stt_errors_total",
  help: "Voice STT transcription errors by provider and classified error_type",
  labelNames: ["provider", "error_type"] as const,
  registers: [metricsRegistry],
});

// ─── Voice Slice 2 — Transcript Cleanup ─────────────────────────────────────
// Spec: docs/superpowers/specs/2026-05-16-voice-input-and-transcription-design.md §9

export const voiceCleanupRunsTotal = new Counter({
  name: "dpf_voice_cleanup_runs_total",
  help: "Transcript cleanup runs by outcome and whether injection was suspected",
  labelNames: ["outcome", "injection_suspected"] as const,
  registers: [metricsRegistry],
});

export const voiceCleanupLevenshteinRatio = new Histogram({
  name: "dpf_voice_cleanup_levenshtein_ratio",
  help: "Levenshtein distance ratio between raw and cleaned transcript (0=identical, 1=totally different)",
  buckets: [0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 0.9],
  registers: [metricsRegistry],
});
