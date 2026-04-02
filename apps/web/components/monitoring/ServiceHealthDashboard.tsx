"use client";

// Service-level health view for the portal product's Health tab.
// Shows the same monitoring data as SystemHealthDashboard but:
//  - No ContainerResourceTable (infrastructure detail)
//  - No hardcoded Grafana link (infrastructure tooling)
//  - Labels use service-level language, not infrastructure language

import { MonitoringProvider, useMonitoringStatus } from "./MonitoringContext";
import { AlertBanner } from "./AlertBanner";
import { ServiceStatusGrid, DPF_SERVICES } from "./ServiceStatusGrid";
import { MetricGauge } from "./MetricGauge";
import { MetricTimeSeries } from "./MetricTimeSeries";
import { MetricTable } from "./MetricTable";
import { AiCoworkerHealthPanel } from "./AiCoworkerHealthPanel";
import { RecentAlertsPanel } from "./RecentAlertsPanel";

export function ServiceHealthDashboard() {
  return (
    <MonitoringProvider>
      <ServiceHealthContent />
    </MonitoringProvider>
  );
}

function ServiceHealthContent() {
  const { online, checked } = useMonitoringStatus();

  if (!checked) {
    return (
      <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-6 text-center">
        <p className="text-sm text-[var(--dpf-muted)]">Checking platform health...</p>
      </div>
    );
  }

  if (!online) {
    return (
      <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-6 text-center space-y-2">
        <p className="text-sm text-[var(--dpf-text)] font-medium">Health data is currently unavailable</p>
        <p className="text-xs text-[var(--dpf-muted)]">
          Platform monitoring services are starting up or temporarily unreachable.
          This page will update automatically when data becomes available.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Active alerts */}
      <AlertBanner />

      {/* Service status */}
      <ServiceStatusGrid services={DPF_SERVICES} />

      {/* Platform resource utilization */}
      <section>
        <h3 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-wider mb-2">
          Platform Resource Utilization
        </h3>
        <div className="grid grid-cols-3 gap-3">
          <MetricGauge
            query='100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)'
            label="Compute"
            thresholds={{ warning: 70, critical: 85 }}
          />
          <MetricGauge
            query="(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100"
            label="Memory"
            thresholds={{ warning: 70, critical: 85 }}
          />
          <MetricGauge
            query='(1 - node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}) * 100'
            label="Storage"
            thresholds={{ warning: 70, critical: 90 }}
          />
        </div>
      </section>

      {/* AI Coworker health */}
      <AiCoworkerHealthPanel />

      {/* Database health */}
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

      {/* AI Inference */}
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

      {/* Recent alerts */}
      <RecentAlertsPanel />
    </div>
  );
}
