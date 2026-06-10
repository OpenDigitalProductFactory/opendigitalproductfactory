"use client";

import Link from "next/link";

import {
  TONE_COLOR,
  deriveMonitoringSummary,
  derivePlatformSummary,
  type HealthSummary,
  type Tone,
} from "./health-summary";
import { useAlertQuery } from "./useAlertQuery";
import { useMetricQuery } from "./useMetricQuery";
import { useMonitoringStatus } from "./MonitoringContext";

type Props = {
  openBacklogItems: number;
  backlogHref: string;
};

export function PortalHealthSummary({ openBacklogItems, backlogHref }: Props) {
  const { checked, online } = useMonitoringStatus();
  const { data: upTargets, loading: upTargetsLoading } = useMetricQuery("up");
  const { alerts } = useAlertQuery();

  const platform = derivePlatformSummary({
    checked,
    online,
    upTargets,
    upTargetsLoading,
    alerts,
  });

  const monitoring = deriveMonitoringSummary({
    checked,
    online,
    upTargets,
    upTargetsLoading,
    alerts,
  });

  const hasBacklog = openBacklogItems > 0;
  const backlogTone: Tone = hasBacklog ? "warning" : "success";

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <HealthCard label="Platform Status" summary={platform} />
      <HealthCard
        label="Open Backlog Items"
        summary={{
          value: String(openBacklogItems),
          tone: backlogTone,
          detail: hasBacklog ? "View list" : "No open backlog items",
        }}
        // Only link (and render the "->" affordance) when there's actually a
        // backlog to view — at zero, the arrow misleadingly implies a
        // navigable list (BI-FDE4A056).
        href={hasBacklog ? backlogHref : undefined}
      />
      <HealthCard label="Health Monitoring" summary={monitoring} />
    </div>
  );
}

function HealthCard({
  label,
  summary,
  href,
}: {
  label: string;
  summary: HealthSummary;
  href?: string;
}) {
  const body = (
    <div className="h-full rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 transition-colors hover:border-[var(--dpf-accent)]">
      <div className="text-lg font-bold" style={{ color: TONE_COLOR[summary.tone] }}>
        {summary.value}
      </div>
      <div className="mt-1 text-[11px] text-[var(--dpf-muted)]">{label}</div>
      <div className="mt-1 text-[10px] leading-4 text-[var(--dpf-muted)]">
        {summary.detail}
        {href ? " ->" : ""}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block">
        {body}
      </Link>
    );
  }

  return body;
}
