"use client";

import { MonitoringProvider, useMonitoringStatus } from "./MonitoringContext";
import { AlertBanner } from "./AlertBanner";
import { ServiceStatusGrid, DPF_SERVICES } from "./ServiceStatusGrid";
import { MetricGauge } from "./MetricGauge";
import { MetricTimeSeries } from "./MetricTimeSeries";
import { MetricStat } from "./MetricStat";
import { MetricTable } from "./MetricTable";
import { ContainerResourceTable } from "./ContainerResourceTable";
import { AiCoworkerHealthPanel } from "./AiCoworkerHealthPanel";
import { RecentAlertsPanel } from "./RecentAlertsPanel";

export function SystemHealthDashboard() {
  return (
    <MonitoringProvider>
      <SystemHealthContent />
    </MonitoringProvider>
  );
}

function MonitoringOfflineBanner() {
  const { online, checked } = useMonitoringStatus();

  if (!checked) {
    return (
      <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-6 text-center">
        <p className="text-sm text-[var(--dpf-muted)]">Checking monitoring stack...</p>
      </div>
    );
  }

  if (!online) {
    return (
      <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-6 text-center space-y-2">
        <p className="text-sm text-[var(--dpf-text)] font-medium">Monitoring stack is not running</p>
        <p className="text-xs text-[var(--dpf-muted)]">
          Start with: <code className="bg-[var(--dpf-bg)] px-1.5 py-0.5 rounded text-[10px]">docker compose --profile monitoring up -d</code>
        </p>
        <p className="text-xs text-[var(--dpf-muted)]">
          This adds Prometheus, Grafana, and container metrics for operational visibility (~350 MB RAM).
        </p>
      </div>
    );
  }

  return null;
}

function SystemHealthContent() {
  const { online, checked } = useMonitoringStatus();

  if (!checked || !online) {
    return (
      <div className="space-y-6">
        <MonitoringOfflineBanner />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Firing alerts */}
      <AlertBanner />

      {/* Service status grid */}
      <ServiceStatusGrid services={DPF_SERVICES} />

      {/* Host resource gauges */}
      <section>
        <h3 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-wider mb-2">
          Host Resources
        </h3>
        <div className="grid grid-cols-3 gap-3">
          <MetricGauge
            query='100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)'
            label="CPU"
            thresholds={{ warning: 70, critical: 85 }}
          />
          <MetricGauge
            query="(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100"
            label="Memory"
            thresholds={{ warning: 70, critical: 85 }}
          />
          <MetricGauge
            query='(1 - node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}) * 100'
            label="Disk"
            thresholds={{ warning: 70, critical: 90 }}
          />
        </div>
      </section>

      {/* AI Coworker health */}
      <AiCoworkerHealthPanel />

      {/* Container resources */}
      <ContainerResourceTable />

      {/* Database section */}
      <section>
        <h3 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-wider mb-2">
          Database
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <MetricTable
            rows={[
              {
                label: "Active Connections",
                query: "pg_stat_activity_count",
                sparkQuery: "pg_stat_activity_count",
              },
              {
                label: "Max Connections",
                query: "pg_settings_max_connections",
              },
              {
                label: "Pool Utilization",
                query: "pg_stat_activity_count / pg_settings_max_connections * 100",
                unit: "%",
                sparkQuery: "pg_stat_activity_count / pg_settings_max_connections * 100",
              },
            ]}
          />
          <MetricTimeSeries
            query="pg_stat_activity_count"
            label="Connection Count (1h)"
            duration="1h"
          />
        </div>
      </section>

      {/* AI Inference charts */}
      <section>
        <h3 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-wider mb-2">
          AI Inference
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <MetricTimeSeries
            query="histogram_quantile(0.95, rate(dpf_ai_inference_duration_seconds_bucket[5m]))"
            label="Inference Latency p95 (1h)"
            unit="s"
            duration="1h"
          />
          <MetricTimeSeries
            query="rate(dpf_semantic_memory_ops_total[5m])"
            label="Semantic Memory Ops/s (1h)"
            duration="1h"
          />
        </div>
      </section>

      {/* Recent alerts history */}
      <RecentAlertsPanel />

      {/* Grafana link */}
      <section className="pt-2 border-t border-[var(--dpf-border)]">
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--dpf-muted)]">Advanced:</span>
          <a
            href="http://localhost:3002"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-[var(--dpf-accent)] hover:underline"
          >
            Open Grafana for custom queries
          </a>
        </div>
      </section>
    </div>
  );
}

