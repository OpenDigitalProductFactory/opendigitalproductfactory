"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { AskCoworkerButton } from "@/components/agent/AskCoworkerButton";
import { proposeActivityHarnessOverrideAction } from "@/lib/actions/activity-harness-routing";
import { AI_PROVIDER_CONNECTIONS_ROUTE } from "@/lib/ai-provider-routes";
import type { OperationsMapActivityRouting } from "@/lib/ai-operations-map/types";
import {
  ACTIVITY_CLASS_COPY,
  CONFIDENCE_COPY,
  DISTRIBUTION_COPY,
  RISK_COPY,
  SUCCESS_SIGNAL_COPY,
  emptyOutcomeEvidenceSummary,
  presentModelRoute,
  presentRecipeKey,
} from "@/lib/ai-operations-map/route-labels";
import { PhaseRemediationActions } from "./PhaseRemediationActions";
import { TechnicalDetails } from "./ActivityRoutingPresentation";

type ActivityStep = OperationsMapActivityRouting["activities"][number];
type ActivityFilter = "all" | "attention";

function needsAttention(activity: ActivityStep): boolean {
  return activity.successSignal === "attention" || activity.successSignal === "failed";
}

function describeActivityShape(activity: ActivityStep): string {
  return [
    ACTIVITY_CLASS_COPY[activity.activityClass],
    DISTRIBUTION_COPY[activity.distributionShape].label,
    RISK_COPY[activity.riskClass].label,
  ].join(" · ");
}

function modelRouteLabel(activity: ActivityStep): string {
  if (!activity.selectedProviderId && !activity.selectedModelId) return "No model selected yet";
  return presentModelRoute(activity.selectedProviderId, activity.selectedModelId).label;
}

function recipeLabel(activity: ActivityStep): string {
  const presentation = presentRecipeKey(activity.harnessRecipeKey, {
    providerId: activity.selectedProviderId,
    modelId: activity.selectedModelId,
  });
  if (presentation.parsed) {
    return `${CONFIDENCE_COPY[presentation.parsed.confidence].label} recipe for ${ACTIVITY_CLASS_COPY[presentation.parsed.activity]}`;
  }
  return presentation.technicalId ? "Custom recipe" : "No recipe bound yet";
}

function canQueueApproval(activity: ActivityStep): boolean {
  return Boolean(
    activity.actionProposalId &&
      activity.actionProposalSummary &&
      activity.harnessRecipeKey &&
      activity.selectedProviderId &&
      activity.actionProposalRecommendedConfidence &&
      !activity.approvedConfidenceOverrideId,
  );
}

function originatingWorkHref(taskRef: OperationsMapActivityRouting["taskRef"]): string | null {
  if (taskRef.buildId) return `/build?buildId=${encodeURIComponent(taskRef.buildId)}`;
  if (taskRef.workCaseId) return `/build/work/${encodeURIComponent(taskRef.workCaseId)}`;
  return null;
}

export function buildActivityCoworkerPrompt(activity: ActivityStep): string {
  const exclusions = activity.exclusions
    .slice(0, 3)
    .map((exclusion) => exclusion.reason)
    .join("; ");
  const remediation = activity.exclusions
    .map((exclusion) => exclusion.remediation?.trim())
    .find(Boolean);
  const candidate = activity.enableCandidates?.[0];
  return [
    "Investigate this governed AI routing decision and recommend the safest next step.",
    `Activity: ${activity.label}.`,
    `Status: ${SUCCESS_SIGNAL_COPY[activity.successSignal].label}.`,
    `Work shape: ${describeActivityShape(activity)}.`,
    `Model route: ${modelRouteLabel(activity)}.`,
    `Decision: ${activity.decisionSummary}`,
    exclusions ? `Exclusions: ${exclusions}.` : null,
    remediation ? `Recorded remediation: ${remediation}` : null,
    candidate
      ? `Disabled provider candidate: ${candidate.displayName}; required action: ${candidate.actionLabel}; satisfies ${candidate.satisfies.join(", ")}.`
      : null,
    "Use live platform evidence before proposing any change. Do not claim that a provider is enabled or healthy without verifying it.",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export function ActivityRoutingWorkbench({
  activityRouting,
}: {
  activityRouting: OperationsMapActivityRouting | null;
}) {
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(() => {
    if (!activityRouting) return null;
    return (
      activityRouting.activities.find(needsAttention)?.activityId ??
      activityRouting.activities[0]?.activityId ??
      null
    );
  });
  const [isApprovalPending, startApprovalTransition] = useTransition();
  const [pendingProposalId, setPendingProposalId] = useState<string | null>(null);
  const [approvalStatusByActivity, setApprovalStatusByActivity] = useState<Record<string, string>>({});

  if (!activityRouting || activityRouting.activities.length === 0) {
    return <ActivityRoutingEmptyState />;
  }

  const attentionActivities = activityRouting.activities.filter(needsAttention);
  const defaultActivity = attentionActivities[0] ?? activityRouting.activities[0];
  const selectedActivity =
    activityRouting.activities.find((activity) => activity.activityId === selectedActivityId) ??
    defaultActivity;
  const visibleActivities = filter === "attention" ? attentionActivities : activityRouting.activities;

  const selectFilter = (nextFilter: ActivityFilter) => {
    setFilter(nextFilter);
    if (nextFilter === "attention" && !needsAttention(selectedActivity)) {
      setSelectedActivityId(attentionActivities[0]?.activityId ?? selectedActivity.activityId);
    }
  };

  const queueApproval = (activity: ActivityStep) => {
    if (
      !activity.actionProposalId ||
      !activity.actionProposalSummary ||
      !activity.harnessRecipeKey ||
      !activity.selectedProviderId ||
      !activity.actionProposalRecommendedConfidence
    ) {
      return;
    }
    const proposalId = activity.actionProposalId;
    setPendingProposalId(proposalId);
    startApprovalTransition(async () => {
      const result = await proposeActivityHarnessOverrideAction({
        proposalId,
        activityClass: activity.activityClass,
        harnessRecipeKey: activity.harnessRecipeKey!,
        providerId: activity.selectedProviderId!,
        modelId: activity.selectedModelId,
        confidence: activity.actionProposalRecommendedConfidence!,
        summary: activity.actionProposalSummary!,
      });
      setApprovalStatusByActivity((current) => ({
        ...current,
        [activity.activityId]: result.success
          ? result.existing
            ? "Approval already queued"
            : "Approval queued"
          : result.error,
      }));
      setPendingProposalId(null);
    });
  };

  return (
    <section
      id="activity-routing-workbench"
      aria-label="Activity routing workbench"
      className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--dpf-accent)]">
            Routing decisions
          </p>
          <h2 className="mt-1 text-lg font-semibold text-[var(--dpf-text)]">
            Follow the work, one activity at a time
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--dpf-muted)]">
            Select a step to see why it was routed, what happened, and the next supported action.
          </p>
        </div>
        <p className="text-xs text-[var(--dpf-muted)]">
          Updated {formatReplayTime(Date.parse(activityRouting.generatedAt))}
        </p>
      </div>

      <div
        role="group"
        aria-label="Activity list filter"
        className="mt-4 inline-flex rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-1"
      >
        <FilterButton
          active={filter === "all"}
          label={`All activities (${activityRouting.activities.length})`}
          onClick={() => selectFilter("all")}
        />
        <FilterButton
          active={filter === "attention"}
          label={`Needs attention (${attentionActivities.length})`}
          onClick={() => selectFilter("attention")}
          disabled={attentionActivities.length === 0}
        />
      </div>

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(16rem,0.72fr)_minmax(0,1.8fr)]">
        <ActivityList
          activities={visibleActivities}
          selectedActivityId={selectedActivity.activityId}
          onSelect={setSelectedActivityId}
        />
        <ActivityDecisionInspector
          activity={selectedActivity}
          taskRef={activityRouting.taskRef}
          approvalStatus={approvalStatusByActivity[selectedActivity.activityId]}
          approvalPending={
            isApprovalPending && pendingProposalId === selectedActivity.actionProposalId
          }
          onQueueApproval={() => queueApproval(selectedActivity)}
        />
      </div>
    </section>
  );
}

function ActivityRoutingEmptyState() {
  return (
    <section
      aria-label="Activity routing workbench"
      data-activity-routing-empty
      className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--dpf-accent)]">
        Routing decisions
      </p>
      <h2 className="mt-1 text-lg font-semibold text-[var(--dpf-text)]">
        No activity route evidence yet
      </h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--dpf-muted)]">
        ActivityContract-backed route decisions with harness evidence will appear here after routed activity requests execute.
      </p>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <EmptyStateStep label="Compile activity" detail="Normalize task intent, outcome, risk, and token shape." />
        <EmptyStateStep label="Bind harness" detail="Attach provider, model, recipe, and confidence policy." />
        <EmptyStateStep label="Record outcome" detail="Surface route decisions with harness evidence and tuning signals." />
      </div>
    </section>
  );
}

function ActivityList({
  activities,
  selectedActivityId,
  onSelect,
}: {
  activities: ActivityStep[];
  selectedActivityId: string;
  onSelect: (activityId: string) => void;
}) {
  return (
    <ol aria-label="Activity route steps" className="space-y-2">
      {activities.map((activity, index) => {
        const selected = activity.activityId === selectedActivityId;
        return (
          <li key={activity.activityId} data-activity-list-item>
            <button
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(activity.activityId)}
              className={[
                "dpf-tap-target w-full rounded-lg border p-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]",
                selected
                  ? "border-[var(--dpf-accent)] bg-[var(--dpf-accent-soft)]"
                  : "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] hover:border-[var(--dpf-accent)]",
              ].join(" ")}
            >
              <span className="flex items-start gap-3">
                <span className="mt-0.5 text-xs font-semibold text-[var(--dpf-muted)]">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-2">
                    <span className="font-semibold leading-5 text-[var(--dpf-text)]">
                      {activity.label}
                    </span>
                    <span className={["shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium", activitySignalClass(activity.successSignal)].join(" ")}>
                      {SUCCESS_SIGNAL_COPY[activity.successSignal].label}
                    </span>
                  </span>
                  <span className="mt-1 block text-sm text-[var(--dpf-muted)]">
                    {modelRouteLabel(activity)}
                  </span>
                  <span className="mt-1 block text-xs text-[var(--dpf-muted)]">
                    {RISK_COPY[activity.riskClass].label} · {activity.confidence ? CONFIDENCE_COPY[activity.confidence].label : "Unrated"}
                  </span>
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function ActivityDecisionInspector({
  activity,
  taskRef,
  approvalStatus,
  approvalPending,
  onQueueApproval,
}: {
  activity: ActivityStep;
  taskRef: OperationsMapActivityRouting["taskRef"];
  approvalStatus?: string;
  approvalPending: boolean;
  onQueueApproval: () => void;
}) {
  const recipe = presentRecipeKey(activity.harnessRecipeKey, {
    providerId: activity.selectedProviderId,
    modelId: activity.selectedModelId,
  });
  const emptyEvidence = emptyOutcomeEvidenceSummary(activity);
  const workHref = originatingWorkHref(taskRef);
  const recordedRemediation = activity.exclusions
    .map((exclusion) => exclusion.remediation?.trim())
    .find(Boolean);
  const queueable = canQueueApproval(activity);

  return (
    <section
      aria-label="Activity decision details"
      className={["rounded-xl border p-4", activityDecisionPanelClass(activity.successSignal)].join(" ")}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={["rounded-full border px-2 py-0.5 text-xs font-semibold", activitySignalClass(activity.successSignal)].join(" ")}>
              {SUCCESS_SIGNAL_COPY[activity.successSignal].label}
            </span>
            <span className="text-xs text-[var(--dpf-muted)]">{describeActivityShape(activity)}</span>
          </div>
          <h3 className="mt-2 text-lg font-semibold text-[var(--dpf-text)]">{activity.label}</h3>
          <p className="mt-2 text-sm leading-6 text-[var(--dpf-text)]">{activity.decisionSummary}</p>
          {activity.tuningRationale ? (
            <p className="mt-2 text-sm leading-6 text-[var(--dpf-muted)]">{activity.tuningRationale}</p>
          ) : null}
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <h4 className="text-sm font-semibold text-[var(--dpf-text)]">Next supported action</h4>
        {recordedRemediation ? (
          <p className="mt-1 text-sm leading-6 text-[var(--dpf-muted)]">{recordedRemediation}</p>
        ) : (
          <p className="mt-1 text-sm leading-6 text-[var(--dpf-muted)]">
            Review the evidence, then act through a governed control or hand the decision to a coworker.
          </p>
        )}

        {activity.enableCandidates && activity.enableCandidates.length > 0 ? (
          <PhaseRemediationActions candidates={activity.enableCandidates} />
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {queueable ? (
            <button
              type="button"
              data-dpf-primary-action
              onClick={onQueueApproval}
              disabled={approvalPending}
              className="dpf-tap-target rounded-lg bg-[var(--dpf-accent)] px-3 text-sm font-semibold text-[var(--dpf-on-accent,var(--dpf-surface-1))] disabled:cursor-wait disabled:opacity-60"
            >
              {approvalPending ? "Queueing…" : "Queue approval"}
            </button>
          ) : null}
          {workHref ? (
            <Link
              href={workHref}
              className="dpf-tap-target inline-flex items-center rounded-lg border border-[var(--dpf-border)] px-3 text-sm font-semibold text-[var(--dpf-text)] hover:border-[var(--dpf-accent)]"
            >
              Open originating work
            </Link>
          ) : null}
          {!activity.enableCandidates?.length && recordedRemediation ? (
            <Link
              href={AI_PROVIDER_CONNECTIONS_ROUTE}
              className="dpf-tap-target inline-flex items-center rounded-lg border border-[var(--dpf-border)] px-3 text-sm font-semibold text-[var(--dpf-text)] hover:border-[var(--dpf-accent)]"
            >
              Open Providers &amp; Routing
            </Link>
          ) : null}
          <AskCoworkerButton
            prompt={buildActivityCoworkerPrompt(activity)}
            routeContext="/platform/ai/operations-map"
            label="Ask coworker to investigate"
            confirmation={{
              title: "Investigate this routing issue",
              contextSummary: `${activity.label}: ${SUCCESS_SIGNAL_COPY[activity.successSignal].label.toLowerCase()} with ${activity.exclusions.length} recorded exclusion${activity.exclusions.length === 1 ? "" : "s"}.`,
              expectedNextStep: "The coworker will verify live provider and routing evidence, then recommend a governed next step.",
            }}
            className="dpf-tap-target rounded-lg border border-[var(--dpf-accent)] px-3 text-sm font-semibold text-[var(--dpf-accent)] hover:bg-[var(--dpf-accent-soft)]"
          />
        </div>
        {approvalStatus ? (
          <p role="status" className="mt-2 text-sm text-[var(--dpf-muted)]">{approvalStatus}</p>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <InspectorSection title="Route choice">
          <dl className="space-y-2">
            <ActivityEvidenceFact label="Model" value={modelRouteLabel(activity)} />
            <ActivityEvidenceFact label="Confidence" value={activity.confidence ? CONFIDENCE_COPY[activity.confidence].label : "Unrated"} />
            <ActivityEvidenceFact label="Harness" value={recipe.label ?? recipeLabel(activity)} />
          </dl>
        </InspectorSection>

        <InspectorSection title="Outcome evidence">
          {emptyEvidence ? (
            <p className="text-sm leading-6 text-[var(--dpf-muted)]">{emptyEvidence}</p>
          ) : (
            <dl className="space-y-2 text-sm">
              <ActivityEvidenceFact label="Signal" value={SUCCESS_SIGNAL_COPY[activity.successSignal].label} />
              <ActivityEvidenceFact label="Tokens" value={activity.tokenTotal == null ? "Not recorded" : activity.tokenTotal.toLocaleString()} />
              <ActivityEvidenceFact label="Cost" value={activity.costUsd == null ? "Not recorded" : `$${activity.costUsd.toFixed(4)}`} />
            </dl>
          )}
        </InspectorSection>

        <InspectorSection title="Alternatives excluded">
          {activity.exclusions.length > 0 ? (
            <ul className="space-y-2 text-sm leading-6 text-[var(--dpf-muted)]">
              {activity.exclusions.slice(0, 3).map((exclusion, index) => (
                <li key={`${activity.activityId}:exclusion:${index}`}>{exclusion.reason}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm leading-6 text-[var(--dpf-muted)]">No alternatives were excluded for this route.</p>
          )}
        </InspectorSection>
      </div>

      <TechnicalDetails
        entries={[
          { label: "Route decision", value: activity.routeDecisionId },
          { label: "Recipe key", value: activity.harnessRecipeKey },
          { label: "Provider id", value: activity.selectedProviderId },
          { label: "Model id", value: activity.selectedModelId },
          { label: "Adapter run", value: activity.adapterTelemetryId },
          { label: "Override", value: activity.approvedConfidenceOverrideId },
        ]}
      />
    </section>
  );
}

function InspectorSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--dpf-muted)]">{title}</h4>
      {children}
    </section>
  );
}

function ActivityEvidenceFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <dt className="shrink-0 text-[var(--dpf-muted)]">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium text-[var(--dpf-text)]">{value}</dd>
    </div>
  );
}

function FilterButton({
  active,
  disabled = false,
  label,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={[
        "dpf-tap-target rounded-md px-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)] disabled:opacity-50",
        active ? "bg-[var(--dpf-surface-1)] text-[var(--dpf-text)] shadow-sm" : "text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function EmptyStateStep({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
      <p className="text-sm font-semibold text-[var(--dpf-text)]">{label}</p>
      <p className="mt-1 text-sm leading-6 text-[var(--dpf-muted)]">{detail}</p>
    </div>
  );
}

function formatReplayTime(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return "Unknown time";
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(new Date(timestamp));
}

function activitySignalClass(signal: ActivityStep["successSignal"]): string {
  switch (signal) {
    case "failed":
      return "border-[var(--dpf-error)] bg-[color-mix(in_srgb,var(--dpf-error)_10%,var(--dpf-surface-1))] text-[var(--dpf-text)]";
    case "attention":
    case "retried":
      return "border-[var(--dpf-warning)] bg-[color-mix(in_srgb,var(--dpf-warning)_10%,var(--dpf-surface-1))] text-[var(--dpf-text)]";
    case "accepted":
    case "review-passed":
    case "valid":
      return "border-[var(--dpf-success)] bg-[color-mix(in_srgb,var(--dpf-success)_10%,var(--dpf-surface-1))] text-[var(--dpf-text)]";
    case "unknown":
      return "border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-muted)]";
    default: {
      const exhaustive: never = signal;
      return exhaustive;
    }
  }
}

function activityDecisionPanelClass(signal: ActivityStep["successSignal"]): string {
  switch (signal) {
    case "failed":
      return "border-[var(--dpf-error)] bg-[color-mix(in_srgb,var(--dpf-error)_6%,var(--dpf-surface-2))]";
    case "attention":
    case "retried":
      return "border-[var(--dpf-warning)] bg-[color-mix(in_srgb,var(--dpf-warning)_6%,var(--dpf-surface-2))]";
    case "accepted":
    case "review-passed":
    case "valid":
      return "border-[var(--dpf-success)] bg-[color-mix(in_srgb,var(--dpf-success)_6%,var(--dpf-surface-2))]";
    case "unknown":
      return "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)]";
    default: {
      const exhaustive: never = signal;
      return exhaustive;
    }
  }
}
