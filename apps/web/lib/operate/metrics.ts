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

// ─── Authorized Surface Contract ───────────────────────────────────────────

export const authorizedSurfaceOperations = new Counter({
  name: "dpf_authorized_surface_operations_total",
  help: "Authorized Surface operations by protocol operation, outcome, and execution mode",
  labelNames: ["operation", "outcome", "mode", "surface_id"] as const,
  registers: [metricsRegistry],
});

export const authorizedSurfaceLatency = new Histogram({
  name: "dpf_authorized_surface_duration_seconds",
  help: "Authorized Surface projection/query/action latency",
  labelNames: ["operation", "mode", "surface_id"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [metricsRegistry],
});

export const authorizedSurfaceGraphNodes = new Histogram({
  name: "dpf_authorized_surface_graph_nodes",
  help: "Number of semantic nodes returned by an Authorized Surface projection/query",
  labelNames: ["operation", "mode", "surface_id"] as const,
  buckets: [1, 5, 10, 25, 50, 100, 250, 500],
  registers: [metricsRegistry],
});

export const authorizedSurfaceCompatibilityFallbacks = new Counter({
  name: "dpf_authorized_surface_compatibility_fallbacks_total",
  help: "Legacy screen/page perception fallbacks when no complete ASC projection is available",
  labelNames: ["adapter", "reason", "route"] as const,
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

// --- Voice TTS service health (BI-B2E777EB) ---
// dpf-tts (Chatterbox) is /health-only (no /metrics), so it cannot be a scrape
// target and ContainerDown (up==0) cannot see it. Refreshed per /api/metrics
// scrape by refreshVoiceTtsMetrics() (lib/voice-synthesis/service-status.ts).
export const voiceTtsUp = new Gauge({
  name: "dpf_voice_tts_up",
  help: "1 when the active TTS provider is reachable/ready, 0 when down. Managed providers report 1 (not probed).",
  registers: [metricsRegistry],
});

export const voiceTtsEnabled = new Gauge({
  name: "dpf_voice_tts_enabled",
  help: "1 when at least one voice profile has narration enabled (TTS is expected to work), else 0.",
  registers: [metricsRegistry],
});

// --- Dependency health (BI-963DBB05) ---
// /metrics-less core services (neo4j, model-runner, stt) probed per /api/metrics
// scrape by lib/operate/dependency-health.ts. up==0 => unreachable. These cannot
// be Prometheus scrape targets, so ContainerDown (up==0) can never see them.
export const dependencyUp = new Gauge({
  name: "dpf_dependency_up",
  help: "1 when a /metrics-less core dependency is reachable, 0 when down. Labelled by service (neo4j | model-runner | stt).",
  labelNames: ["service"] as const,
  registers: [metricsRegistry],
});

// --- Unhandled server errors (BI-994B504C) ---
// Incremented by the Next.js onRequestError instrumentation hook — the global,
// zero-route-change error signal (the portal has no per-request HTTP wrapper yet).
export const httpUnhandledErrors = new Counter({
  name: "dpf_http_unhandled_errors_total",
  help: "Unhandled server errors caught by the Next.js onRequestError hook, labelled by route + method.",
  labelNames: ["route", "method"] as const,
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

// ─── Workspace-home resolver (BI-1CCC6264 follow-on telemetry) ─────────────
// Spec: docs/superpowers/specs/2026-05-24-vertical-workspace-home-design.md §5.5
//
// Emitted on each /workspace render after the resolver runs. Surfaces the
// silent-fallback case the substrate is honest about but otherwise invisible:
// installs whose configured archetype has NO matching contribution still get
// the platform fallback, and without this counter that gap is observable only
// by per-customer inspection. The counter exposes it as a metric admins can
// alert on.
//
// Labels:
// - match: "exact" | "category" | "none" — which resolver path won.
// - has_archetype: "true" | "false" — whether the install has a StorefrontConfig
//   with an archetype at all. Lets us distinguish:
//     match="none", has_archetype="true"  → configured-but-uncovered (the gap)
//     match="none", has_archetype="false" → cold install (legitimate)
//     match="exact" or "category"         → covered

export const workspaceHomeResolutionsTotal = new Counter({
  name: "dpf_workspace_home_resolutions_total",
  help: "Workspace-home resolver outcomes by match kind and whether the install has a configured archetype. match=none + has_archetype=true is the substrate's honest-fallback surface — track to alert when an archetype lacks a vertical contribution.",
  labelNames: ["match", "has_archetype"] as const,
  registers: [metricsRegistry],
});

// ─── Reusable Queueing Substrate — flow telemetry (EP-3516E23D Phase 1) ───────
// Prometheus mirror of the QueueTelemetryEvent stream so the existing monitoring
// profile graphs every queue (compute lanes AND CWQ work queues) with zero new
// infra. Labelled by the stable queueKey (+ outcome where terminal). Recorded
// from `recordQueueTransition` (lib/queue/queue-telemetry.ts). Spec §4.2.

export const queueDepth = new Gauge({
  name: "dpf_queue_depth",
  help: "Instantaneous count of items waiting in a queue (status=queued).",
  labelNames: ["queue_key"] as const,
  registers: [metricsRegistry],
});

export const queueWaitSeconds = new Histogram({
  name: "dpf_queue_wait_seconds",
  help: "Time an item waited in a queue before a worker/lane started serving it (enqueued→started).",
  labelNames: ["queue_key"] as const,
  buckets: [1, 5, 15, 30, 60, 300, 900, 1800, 3600, 14400],
  registers: [metricsRegistry],
});

export const queueProcessSeconds = new Histogram({
  name: "dpf_queue_process_seconds",
  help: "Time a worker/lane spent serving an item (started→finished).",
  labelNames: ["queue_key", "outcome"] as const,
  buckets: [1, 5, 15, 30, 60, 300, 900, 1800, 3600, 14400],
  registers: [metricsRegistry],
});

export const queueCycleSeconds = new Histogram({
  name: "dpf_queue_cycle_seconds",
  help: "Total time from enqueue to terminal outcome (enqueued→finished/cancelled) — lead time through the queue.",
  labelNames: ["queue_key"] as const,
  buckets: [1, 5, 15, 30, 60, 300, 900, 1800, 3600, 14400, 86400],
  registers: [metricsRegistry],
});

export const queueThroughputTotal = new Counter({
  name: "dpf_queue_throughput_total",
  help: "Items served to a terminal outcome, by queue and outcome (success|failed|cancelled).",
  labelNames: ["queue_key", "outcome"] as const,
  registers: [metricsRegistry],
});

export const queueArrivalsTotal = new Counter({
  name: "dpf_queue_arrivals_total",
  help: "Items entering a queue (enqueued transitions) — demand/arrival rate.",
  labelNames: ["queue_key"] as const,
  registers: [metricsRegistry],
});

// Immutable gate single-flight. Keep labels bounded: exact keys and executor
// ids stay in structured evidence rather than the time-series index.
export const gateRunDispositionsTotal = new Counter({
  name: "dpf_gate_run_dispositions_total",
  help: "Immutable gate claims by gate kind, coordination disposition, and terminal result class.",
  labelNames: ["gate_kind", "disposition", "result_class"] as const,
  registers: [metricsRegistry],
});
