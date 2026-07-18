"use client";

import Link from "next/link";

import {
  TONE_COLOR,
  deriveMonitoringSummary,
  derivePlatformSummary,
  deriveReleaseSummary,
  type HealthSummary,
  type ReleaseHealthCardData,
  type Tone,
} from "./health-summary";
import type { CapabilityServiceHealthProjection } from "@/lib/platform-runtime/service-health";
import { useAlertQuery } from "./useAlertQuery";
import { useMetricQuery } from "./useMetricQuery";
import { useMonitoringStatus } from "./MonitoringContext";

type Props = {
  capabilityHealth: CapabilityServiceHealthProjection | null;
  openBacklogItems: number;
  backlogHref: string;
  // BI-3630773C — latest release stamp state; null when never stamped or
  // never polled. The card always renders so a silent red release can't
  // hide by omission.
  releaseHealth?: ReleaseHealthCardData | null;
};

export function PortalHealthSummary({ capabilityHealth, openBacklogItems, backlogHref, releaseHealth }: Props) {
  const { checked, online } = useMonitoringStatus();
  const { data: upTargets, loading: upTargetsLoading } = useMetricQuery("up");
  const { alerts } = useAlertQuery();

  const platform = capabilityHealth
    ? derivePlatformSummary({ checked, online, capabilityHealth, loading: upTargetsLoading, alerts })
    : {
        value: "Unavailable",
        tone: "critical" as const,
        detail: "Capability authority could not be loaded",
      };

  const monitoring = deriveMonitoringSummary({
    checked,
    online,
    upTargets,
    upTargetsLoading,
    alerts,
  });

  const hasBacklog = openBacklogItems > 0;
  const backlogTone: Tone = hasBacklog ? "warning" : "success";

  const release = deriveReleaseSummary(releaseHealth ?? null);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
      <HealthCard
        label="Latest Release"
        summary={release}
        href={releaseHealth?.runUrl}
      />
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
    // External targets (e.g. the GitHub Actions run behind the Latest
    // Release card) open in a new tab; internal routes stay client-side.
    if (href.startsWith("http")) {
      return (
        <a href={href} target="_blank" rel="noreferrer" className="block">
          {body}
        </a>
      );
    }
    return (
      <Link href={href} className="block">
        {body}
      </Link>
    );
  }

  return body;
}
