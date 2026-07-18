"use client";

// Service-level health view for the portal product's Health tab.
// Shows the same monitoring data as SystemHealthDashboard but:
//  - No ContainerResourceTable (infrastructure detail)
//  - No hardcoded Grafana link (infrastructure tooling)
//  - Labels use service-level language, not infrastructure language

import { MonitoringProvider, useMonitoringStatus } from "./MonitoringContext";
import { AlertBanner } from "./AlertBanner";
import { ServiceStatusGrid } from "./ServiceStatusGrid";
import { MetricGauge } from "./MetricGauge";
import { MetricTimeSeries } from "./MetricTimeSeries";
import { MetricTable } from "./MetricTable";
import { AiCoworkerHealthPanel } from "./AiCoworkerHealthPanel";
import { RecentAlertsPanel } from "./RecentAlertsPanel";
import { PortalHealthSummary } from "./PortalHealthSummary";
import {
  HOST_RESOURCE_QUERIES,
  deriveLegacyPlatformSummary,
  isHostTelemetryConfigured,
} from "./health-summary";
import { useAlertQuery } from "./useAlertQuery";
import { useMetricQuery } from "./useMetricQuery";

import type { ReleaseHealthCardData } from "./health-summary";

type ServiceHealthDashboardProps = {
  openBacklogItems?: number;
  backlogHref?: string;
  releaseHealth?: ReleaseHealthCardData | null;
};

export function ServiceHealthDashboard(props: ServiceHealthDashboardProps = {}) {
  return (
    <MonitoringProvider>
      <ServiceHealthContent {...props} />
    </MonitoringProvider>
  );
}

function ServiceHealthContent({
  openBacklogItems,
  backlogHref,
  releaseHealth,
}: ServiceHealthDashboardProps) {
  const { online, checked } = useMonitoringStatus();
  const { data: upTargets, loading: upTargetsLoading } = useMetricQuery("up");
  const { alerts } = useAlertQuery();

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

  // The Platform Status StatCard surfaces the worst critical alert summary;
  // suppress the matching AlertBanner row so the same line doesn't render
  // twice on the same screen.
  const platform = deriveLegacyPlatformSummary({
    checked,
    online,
    upTargets,
    upTargetsLoading,
    alerts,
  });
  const suppressBannerSummaries =
    platform.tone === "critical" ? [platform.detail] : [];

  const showHostResources = isHostTelemetryConfigured(upTargets);

  return (
    <div className="space-y-6">
      {openBacklogItems !== undefined && backlogHref && (
        <PortalHealthSummary
          openBacklogItems={openBacklogItems}
          backlogHref={backlogHref}
          releaseHealth={releaseHealth}
        />
      )}

      {/* Active alerts (deduped against the Platform Status StatCard above) */}
      <AlertBanner suppressSummaries={suppressBannerSummaries} />

      {/* Service status — targets-driven, so adding a Prometheus scrape job
          automatically adds a tile (no UI change required) and three sandbox
          targets render as three tiles instead of collapsing onto one row. */}
      <ServiceStatusGrid />

      {/* Platform resource utilization — only rendered on substrates that ship
          a host telemetry exporter (Linux node-exporter, Windows windows_exporter).
          macOS Docker Desktop has neither, so we hide the section entirely
          rather than showing three "No data" gauges. */}
      {showHostResources && (
        <section>
          <h3 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-wider mb-2">
            Platform Resource Utilization
          </h3>
          <div className="grid grid-cols-3 gap-3">
            <MetricGauge
              query={HOST_RESOURCE_QUERIES.compute}
              label="Compute"
              thresholds={{ warning: 70, critical: 85 }}
            />
            <MetricGauge
              query={HOST_RESOURCE_QUERIES.memory}
              label="Memory"
              thresholds={{ warning: 70, critical: 85 }}
            />
            <MetricGauge
              query={HOST_RESOURCE_QUERIES.storage}
              label="Storage"
              hint="Highest drive usage"
              thresholds={{ warning: 70, critical: 90 }}
            />
          </div>
        </section>
      )}

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
