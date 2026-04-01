"use client";

import { useMetricQuery } from "./useMetricQuery";
import { MetricTimeSeries } from "./MetricTimeSeries";

export function AiCoworkerHealthPanel() {
  const { data: inferenceUp, offline } = useMetricQuery('up{job="model-runner"}');
  const { data: qdrantUp } = useMetricQuery('up{job="qdrant"}');
  const { data: memErrors } = useMetricQuery(
    "rate(dpf_semantic_memory_errors_total[5m])",
  );
  const { data: inferenceP95 } = useMetricQuery(
    "histogram_quantile(0.95, rate(dpf_ai_inference_duration_seconds_bucket[5m]))",
  );

  if (offline) {
    return (
      <section>
        <h3 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-wider mb-2">
          AI Coworker
        </h3>
        <p className="text-xs text-[var(--dpf-muted)]">Monitoring offline</p>
      </section>
    );
  }

  const inferenceAvailable = parseFloat(inferenceUp?.[0]?.value?.[1] ?? "0") === 1;
  const memoryAvailable = parseFloat(qdrantUp?.[0]?.value?.[1] ?? "0") === 1;
  const hasMemErrors = parseFloat(memErrors?.[0]?.value?.[1] ?? "0") > 0;
  const p95Value = parseFloat(inferenceP95?.[0]?.value?.[1] ?? "0");

  return (
    <section>
      <h3 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-wider mb-2">
        AI Coworker
      </h3>
      <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4 space-y-3">
        {/* Status indicators */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatusIndicator
            label="Inference"
            ok={inferenceAvailable}
            okText="Available"
            failText="Offline"
          />
          <StatusIndicator
            label="Memory"
            ok={memoryAvailable && !hasMemErrors}
            okText="Online"
            failText={!memoryAvailable ? "Offline" : "Errors"}
          />
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-[var(--dpf-muted)]">p95 Latency</span>
            <span className="text-sm font-mono text-[var(--dpf-text)]">
              {p95Value > 0 ? formatLatency(p95Value) : "--"}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-[var(--dpf-muted)]">Memory Errors (5m)</span>
            <span
              className={`text-sm font-mono ${
                hasMemErrors ? "text-red-400 font-bold" : "text-[var(--dpf-text)]"
              }`}
            >
              {hasMemErrors ? "FAILING" : "None"}
            </span>
          </div>
        </div>

        {/* Time series */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <MetricTimeSeries
            query="histogram_quantile(0.95, rate(dpf_ai_inference_duration_seconds_bucket[5m]))"
            label="Inference Latency (1h)"
            unit="s"
            duration="1h"
          />
          <MetricTimeSeries
            query="rate(dpf_semantic_memory_ops_total[5m])"
            label="Memory Ops Rate (1h)"
            duration="1h"
          />
        </div>
      </div>
    </section>
  );
}

function StatusIndicator({
  label,
  ok,
  okText,
  failText,
}: {
  label: string;
  ok: boolean;
  okText: string;
  failText: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className={`w-2.5 h-2.5 rounded-full ${ok ? "bg-green-500" : "bg-red-500 animate-pulse"}`} />
      <div className="flex flex-col">
        <span className="text-xs text-[var(--dpf-muted)]">{label}</span>
        <span
          className={`text-xs font-medium ${ok ? "text-green-500" : "text-red-400"}`}
        >
          {ok ? okText : failText}
        </span>
      </div>
    </div>
  );
}

function formatLatency(seconds: number): string {
  if (seconds >= 1) return `${seconds.toFixed(1)}s`;
  return `${Math.round(seconds * 1000)}ms`;
}
