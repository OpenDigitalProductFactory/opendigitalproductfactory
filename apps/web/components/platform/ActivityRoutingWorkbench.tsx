"use client";

import { useState, useTransition } from "react";
import type { OperationsMapActivityRouting } from "@/lib/ai-operations-map/types";
import { proposeActivityHarnessOverrideAction } from "@/lib/actions/activity-harness-routing";
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
import { TechnicalDetails } from "./ActivityRoutingPresentation";

type ActivityStep = OperationsMapActivityRouting["activities"][number];

/** "summarizing · routine work · Low stakes" — the card subtitle in operator words. */
function describeActivityShape(activity: ActivityStep): string {
  return [
    ACTIVITY_CLASS_COPY[activity.activityClass],
    DISTRIBUTION_COPY[activity.distributionShape].label,
    RISK_COPY[activity.riskClass].label,
  ].join(" · ");
}

/** Short recipe phrase for tight card real estate; full sentence lives in the drawer. */
function shortRecipeLabel(activity: ActivityStep): string {
  const presentation = presentRecipeKey(activity.harnessRecipeKey, {
    providerId: activity.selectedProviderId,
    modelId: activity.selectedModelId,
  });
  if (presentation.parsed) {
    return `${CONFIDENCE_COPY[presentation.parsed.confidence].label} recipe for ${ACTIVITY_CLASS_COPY[presentation.parsed.activity]}`;
  }
  return presentation.technicalId ? "Custom recipe" : "No recipe bound yet";
}

function modelRouteLabel(activity: ActivityStep): string {
  if (!activity.selectedProviderId && !activity.selectedModelId) {
    return "No model selected yet";
  }
  return presentModelRoute(activity.selectedProviderId, activity.selectedModelId).label;
}

/** Whether this activity has a governed action proposal an operator can queue. */
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

/** One plain-language line explaining why a flagged activity needs a look. */
function reviewReason(activity: ActivityStep): string {
  return activity.tuningRationale?.trim() || activity.decisionSummary.trim() || SUCCESS_SIGNAL_COPY[activity.successSignal].description;
}

/** Link to the build/task this activity ran under, using the shared parent ref. */
function originatingWorkHref(taskRef: OperationsMapActivityRouting["taskRef"]): string | null {
  if (taskRef.buildId) return `/build?buildId=${encodeURIComponent(taskRef.buildId)}`;
  if (taskRef.workCaseId) return `/build/work/${encodeURIComponent(taskRef.workCaseId)}`;
  return null;
}

export function ActivityRoutingWorkbench({
  activityRouting,
}: {
  activityRouting: OperationsMapActivityRouting | null;
}) {
  const [isApprovalPending, startApprovalTransition] = useTransition();
  const [pendingProposalId, setPendingProposalId] = useState<string | null>(null);
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
  const [approvalStatusByActivity, setApprovalStatusByActivity] = useState<Record<string, string>>({});
  const [showReviewQueue, setShowReviewQueue] = useState(false);

  if (!activityRouting || activityRouting.activities.length === 0) {
    return (
      <section
        aria-label="Activity routing workbench"
        data-activity-routing-empty
        className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--dpf-muted)]">
              Activity routing workbench
            </p>
            <h2 className="mt-1 text-sm font-semibold text-[var(--dpf-text)]">
              No activity route evidence yet
            </h2>
            <p className="mt-2 max-w-3xl text-xs leading-5 text-[var(--dpf-muted)]">
              ActivityContract-backed route decisions with harness evidence will appear here after routed
              activity requests execute.
            </p>
          </div>
          <span className="rounded border border-[var(--dpf-border)] px-2 py-1 text-[11px] text-[var(--dpf-muted)]">
            Waiting for routed activity
          </span>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <EmptyStateStep label="Compile activity" detail="Normalize task intent, outcome, risk, and token shape." />
          <EmptyStateStep label="Bind harness" detail="Attach provider, model, recipe, and confidence policy." />
          <EmptyStateStep label="Record outcome" detail="Surface route decisions with harness evidence and tuning signals." />
        </div>
      </section>
    );
  }

  const selectedActivity =
    activityRouting.activities.find((activity) => activity.activityId === selectedActivityId) ??
    activityRouting.activities[0];
  const attentionActivities = activityRouting.activities.filter(
    (activity) => activity.successSignal === "attention" || activity.successSignal === "failed",
  );
  const attentionCount = attentionActivities.length;
  const queueApproval = (activity: OperationsMapActivityRouting["activities"][number]) => {
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
    const harnessRecipeKey = activity.harnessRecipeKey;
    const providerId = activity.selectedProviderId;
    const confidence = activity.actionProposalRecommendedConfidence;
    const summary = activity.actionProposalSummary;

    setPendingProposalId(proposalId);
    startApprovalTransition(async () => {
      const result = await proposeActivityHarnessOverrideAction({
        proposalId,
        activityClass: activity.activityClass,
        harnessRecipeKey,
        providerId,
        modelId: activity.selectedModelId,
        confidence,
        summary,
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
      aria-label="Activity routing workbench"
      className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--dpf-muted)]">
            Activity routing workbench
          </p>
          <h2 className="mt-1 text-sm font-semibold text-[var(--dpf-text)]">
            {activityRouting.activities.length} routed activity steps
          </h2>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px] text-[var(--dpf-muted)]">
          <span className="rounded border border-[var(--dpf-border)] px-2 py-1">
            Updated {formatReplayTime(Date.parse(activityRouting.generatedAt))}
          </span>
          {attentionCount > 0 ? (
            <button
              type="button"
              onClick={() => setShowReviewQueue((open) => !open)}
              aria-expanded={showReviewQueue}
              aria-controls="activity-review-queue"
              className="inline-flex items-center gap-1 rounded border border-[var(--dpf-warning)] bg-[color-mix(in_srgb,var(--dpf-warning)_12%,var(--dpf-surface-1))] px-2 py-1 font-medium text-[var(--dpf-text)] transition-colors hover:bg-[color-mix(in_srgb,var(--dpf-warning)_20%,var(--dpf-surface-1))] focus:outline-none focus:ring-2 focus:ring-[var(--dpf-warning)]"
            >
              {attentionCount} {attentionCount === 1 ? "needs" : "need"} review
              <span aria-hidden="true">{showReviewQueue ? "▾" : "▸"}</span>
            </button>
          ) : null}
        </div>
      </div>

      {showReviewQueue && attentionCount > 0 ? (
        <ActivityReviewQueue
          activities={attentionActivities}
          taskRef={activityRouting.taskRef}
          approvalStatusByActivity={approvalStatusByActivity}
          isApprovalPending={isApprovalPending}
          pendingProposalId={pendingProposalId}
          onQueueApproval={queueApproval}
          onInspect={(activityId) => {
            setSelectedActivityId(activityId);
            setShowReviewQueue(false);
          }}
        />
      ) : null}

      <ActivityFlowRail
        activities={activityRouting.activities}
        selectedActivityId={selectedActivity.activityId}
        onSelectActivity={setSelectedActivityId}
      />

      <ActivityDecisionDrawer activity={selectedActivity} />

      <div className="mt-3 grid gap-2 lg:grid-cols-2 xl:grid-cols-3">
        {activityRouting.activities.map((activity) => {
          const cardCanQueueApproval = canQueueApproval(activity);
          return (
            <article
              key={activity.activityId}
              data-activity-routing-step
              className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-[var(--dpf-text)]">
                    {activity.label}
                  </h3>
                  <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                    {describeActivityShape(activity)}
                  </p>
                </div>
                <span
                  className={[
                    "shrink-0 rounded border px-2 py-1 text-[10px] uppercase tracking-[0.14em]",
                    activitySignalClass(activity.successSignal),
                  ].join(" ")}
                  title={SUCCESS_SIGNAL_COPY[activity.successSignal].description}
                >
                  {SUCCESS_SIGNAL_COPY[activity.successSignal].label}
                </span>
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <InspectorFact label="Model route" value={modelRouteLabel(activity)} />
                <InspectorFact label="Harness" value={shortRecipeLabel(activity)} />
                <InspectorFact
                  label="Confidence"
                  value={activity.confidence ? CONFIDENCE_COPY[activity.confidence].label : "Unrated"}
                  title={activity.confidence ? CONFIDENCE_COPY[activity.confidence].description : undefined}
                />
                <InspectorFact label="Tuning" value={activity.tuningRecommendation ?? "Observe"} />
              </dl>
              <TechnicalDetails
                entries={[
                  { label: "Recipe key", value: activity.harnessRecipeKey },
                  { label: "Provider id", value: activity.selectedProviderId },
                  { label: "Model id", value: activity.selectedModelId },
                ]}
              />

              <div className="mt-3 border-t border-[var(--dpf-border)] pt-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--dpf-muted)]">
                  Why this model?
                </p>
                <p className="mt-1 text-xs leading-5 text-[var(--dpf-muted)]">
                  {activity.decisionSummary}
                </p>
                {activity.tuningRationale ? (
                  <p className="mt-2 text-xs leading-5 text-[var(--dpf-muted)]">
                    {activity.tuningRationale}
                  </p>
                ) : null}
                {activity.actionProposalSummary ? (
                  <div className="mt-2 rounded border border-[var(--dpf-border)] px-2 py-2 text-xs leading-5 text-[var(--dpf-text)]">
                    <p>{activity.actionProposalSummary}</p>
                    {activity.actionProposalRecommendedConfidence ? (
                      <p className="mt-1 text-[11px] text-[var(--dpf-muted)]">
                        Proposed confidence: {activity.actionProposalRecommendedConfidence}
                      </p>
                    ) : null}
                    {cardCanQueueApproval ? (
                      <button
                        type="button"
                        onClick={() => queueApproval(activity)}
                        disabled={isApprovalPending && pendingProposalId === activity.actionProposalId}
                        className="mt-2 inline-flex min-h-8 items-center rounded border border-[var(--dpf-accent)] px-2 py-1 text-xs font-medium text-[var(--dpf-text)] transition-colors hover:bg-[var(--dpf-accent-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)] disabled:cursor-wait disabled:opacity-60"
                      >
                        {isApprovalPending && pendingProposalId === activity.actionProposalId ? "Queueing..." : "Queue approval"}
                      </button>
                    ) : null}
                    {approvalStatusByActivity[activity.activityId] ? (
                      <p className="mt-1 text-[11px] text-[var(--dpf-muted)]">
                        {approvalStatusByActivity[activity.activityId]}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {activity.approvedConfidenceOverrideId ? (
                  <p className="mt-2 text-xs leading-5 text-[var(--dpf-muted)]">
                    Approved override: {activity.approvedConfidenceOverrideId}
                  </p>
                ) : null}
                {activity.exclusions.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-xs text-[var(--dpf-muted)]">
                    {activity.exclusions.map((exclusion, index) => (
                      <li key={`${activity.activityId}:exclusion:${index}`}>
                        {exclusion.reason}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ActivityReviewQueue({
  activities,
  taskRef,
  approvalStatusByActivity,
  isApprovalPending,
  pendingProposalId,
  onQueueApproval,
  onInspect,
}: {
  activities: ActivityStep[];
  taskRef: OperationsMapActivityRouting["taskRef"];
  approvalStatusByActivity: Record<string, string>;
  isApprovalPending: boolean;
  pendingProposalId: string | null;
  onQueueApproval: (activity: ActivityStep) => void;
  onInspect: (activityId: string) => void;
}) {
  const buildHref = originatingWorkHref(taskRef);
  return (
    <section
      id="activity-review-queue"
      aria-label="Activities needing review"
      className="mt-3 rounded-md border border-[var(--dpf-warning)] bg-[color-mix(in_srgb,var(--dpf-warning)_6%,var(--dpf-surface-1))] p-3"
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--dpf-muted)]">
        Needs review — {activities.length} {activities.length === 1 ? "activity" : "activities"}
      </p>
      <ul className="mt-2 space-y-2">
        {activities.map((activity) => {
          const status = approvalStatusByActivity[activity.activityId];
          const queueable = canQueueApproval(activity);
          const pending = isApprovalPending && pendingProposalId === activity.actionProposalId;
          return (
            <li
              key={activity.activityId}
              data-review-queue-row
              className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3"
            >
              <div className="flex items-start gap-2">
                <span
                  className={[
                    "mt-0.5 shrink-0 rounded border px-2 py-1 text-[10px] uppercase tracking-[0.14em]",
                    activitySignalClass(activity.successSignal),
                  ].join(" ")}
                  title={SUCCESS_SIGNAL_COPY[activity.successSignal].description}
                >
                  {SUCCESS_SIGNAL_COPY[activity.successSignal].label}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-semibold text-[var(--dpf-text)]">
                    {activity.label}
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-[var(--dpf-muted)]">
                    {reviewReason(activity)}
                  </p>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {queueable ? (
                  <button
                    type="button"
                    onClick={() => onQueueApproval(activity)}
                    disabled={pending}
                    className="inline-flex min-h-8 items-center rounded border border-[var(--dpf-accent)] px-2 py-1 text-xs font-medium text-[var(--dpf-text)] transition-colors hover:bg-[var(--dpf-accent-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)] disabled:cursor-wait disabled:opacity-60"
                  >
                    {pending ? "Queueing..." : "Queue approval"}
                  </button>
                ) : buildHref ? (
                  <a
                    href={buildHref}
                    className="inline-flex min-h-8 items-center rounded border border-[var(--dpf-border)] px-2 py-1 text-xs font-medium text-[var(--dpf-text)] transition-colors hover:border-[var(--dpf-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]"
                  >
                    Open originating build
                  </a>
                ) : (
                  <span className="text-[11px] text-[var(--dpf-muted)]">
                    Informational — no action available yet
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onInspect(activity.activityId)}
                  className="inline-flex min-h-8 items-center rounded border border-[var(--dpf-border)] px-2 py-1 text-xs font-medium text-[var(--dpf-muted)] transition-colors hover:border-[var(--dpf-accent)] hover:text-[var(--dpf-text)] focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]"
                >
                  Inspect decision
                </button>
                {status ? (
                  <span className="text-[11px] text-[var(--dpf-muted)]">{status}</span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ActivityFlowRail({
  activities,
  selectedActivityId,
  onSelectActivity,
}: {
  activities: OperationsMapActivityRouting["activities"];
  selectedActivityId: string;
  onSelectActivity: (activityId: string) => void;
}) {
  return (
    <div
      aria-label="Activity routing flow"
      className="mt-3 overflow-x-auto rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--dpf-muted)]">
          Model path
        </p>
        <p className="text-[11px] text-[var(--dpf-muted)]">
          {activities.length} activity nodes
        </p>
      </div>
      <ol className="flex min-w-max items-stretch gap-2">
        {activities.map((activity, index) => {
          const isSelected = activity.activityId === selectedActivityId;
          return (
            <li key={activity.activityId} className="flex items-stretch gap-2">
              <button
                type="button"
                data-activity-flow-node
                data-activity-flow-selected={isSelected ? "true" : undefined}
                aria-pressed={isSelected}
                onClick={() => onSelectActivity(activity.activityId)}
                className={[
                  "flex min-h-40 w-56 flex-col rounded-md border bg-[var(--dpf-surface-1)] p-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]",
                  isSelected
                    ? "border-[var(--dpf-accent)] shadow-[inset_0_0_0_1px_var(--dpf-accent)]"
                    : "border-[var(--dpf-border)] hover:border-[var(--dpf-accent)]",
                ].join(" ")}
              >
                <div className="flex items-start justify-between gap-2">
                  <span
                    className={[
                      "rounded border px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em]",
                      activityFlowRiskClass(activity.riskClass),
                    ].join(" ")}
                    title={RISK_COPY[activity.riskClass].description}
                  >
                    {RISK_COPY[activity.riskClass].label}
                  </span>
                  <span
                    className={[
                      "rounded border px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em]",
                      activityFlowConfidenceClass(activity.confidence),
                    ].join(" ")}
                    title={activity.confidence ? CONFIDENCE_COPY[activity.confidence].description : "This route has not been rated yet."}
                  >
                    {activity.confidence ? CONFIDENCE_COPY[activity.confidence].label : "Unrated"}
                  </span>
                </div>
                <p className="mt-3 line-clamp-2 text-sm font-semibold leading-5 text-[var(--dpf-text)]">
                  {activity.label}
                </p>
                <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                  {ACTIVITY_CLASS_COPY[activity.activityClass]} · {DISTRIBUTION_COPY[activity.distributionShape].label}
                </p>
                <div className="mt-auto space-y-1 pt-3 text-[11px] leading-4 text-[var(--dpf-muted)]">
                  <p className="truncate text-[var(--dpf-text)]" title={`${activity.selectedProviderId ?? "unresolved"} / ${activity.selectedModelId ?? "unresolved"}`}>
                    {modelRouteLabel(activity)}
                  </p>
                  <p className="truncate" title={activity.harnessRecipeKey ?? undefined}>
                    {shortRecipeLabel(activity)}
                  </p>
                </div>
              </button>
              {index < activities.length - 1 ? (
                <div
                  data-activity-flow-connector
                  aria-hidden="true"
                  className={[
                    "flex w-9 shrink-0 items-center justify-center",
                    activityFlowConnectorClass(activity.successSignal),
                  ].join(" ")}
                >
                  <span className="h-px w-full border-t-2" />
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function ActivityDecisionDrawer({
  activity,
}: {
  activity: OperationsMapActivityRouting["activities"][number];
}) {
  const recipePresentation = presentRecipeKey(activity.harnessRecipeKey, {
    providerId: activity.selectedProviderId,
    modelId: activity.selectedModelId,
  });
  const emptyEvidence = emptyOutcomeEvidenceSummary(activity);
  return (
    <section
      aria-label="Activity decision details"
      className={[
        "mt-3 rounded-md border p-3",
        activityDecisionPanelClass(activity.successSignal),
      ].join(" ")}
    >
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(16rem,0.8fr)]">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--dpf-muted)]">
            Decision path
          </p>
          <h3 className="mt-1 text-sm font-semibold text-[var(--dpf-text)]">
            {activity.label}
          </h3>
          <p className="mt-2 text-xs leading-5 text-[var(--dpf-muted)]">
            {activity.decisionSummary}
          </p>
          {activity.tuningRationale ? (
            <p className="mt-2 text-xs leading-5 text-[var(--dpf-muted)]">
              {activity.tuningRationale}
            </p>
          ) : null}
        </div>

        <dl className="grid grid-cols-2 gap-2 text-xs">
          <InspectorFact label="Activity" value={ACTIVITY_CLASS_COPY[activity.activityClass]} />
          <InspectorFact
            label="Shape"
            value={`${DISTRIBUTION_COPY[activity.distributionShape].label} · ${RISK_COPY[activity.riskClass].label}`}
            title={`${DISTRIBUTION_COPY[activity.distributionShape].description} ${RISK_COPY[activity.riskClass].description}`}
          />
          <InspectorFact label="Model route" value={modelRouteLabel(activity)} />
          <InspectorFact
            label="Routing confidence"
            value={activity.confidence ? CONFIDENCE_COPY[activity.confidence].label : "Unrated"}
            title={activity.confidence ? CONFIDENCE_COPY[activity.confidence].description : "This route has not been rated yet."}
          />
        </dl>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-3">
        <div className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--dpf-muted)]">
            Outcome evidence
          </p>
          {emptyEvidence ? (
            <p className="mt-2 text-xs leading-5 text-[var(--dpf-muted)]">{emptyEvidence}</p>
          ) : (
            <dl className="mt-2 space-y-1 text-xs text-[var(--dpf-muted)]">
              <ActivityEvidenceFact
                label="Signal"
                value={SUCCESS_SIGNAL_COPY[activity.successSignal].label}
              />
              <ActivityEvidenceFact label="Tokens" value={activity.tokenTotal == null ? "Not recorded" : activity.tokenTotal.toLocaleString()} />
              <ActivityEvidenceFact label="Cost" value={activity.costUsd == null ? "Not recorded" : `$${activity.costUsd.toFixed(4)}`} />
            </dl>
          )}
          <TechnicalDetails
            entries={[{ label: "Route decision", value: activity.routeDecisionId }]}
          />
        </div>

        <div className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--dpf-muted)]">
            Harness
          </p>
          <p className="mt-2 text-xs leading-5 text-[var(--dpf-text)]">
            {recipePresentation.label ??
              (recipePresentation.technicalId
                ? "Custom recipe — see technical details."
                : "No recipe bound to this route yet.")}
          </p>
          <dl className="mt-2 space-y-1 text-xs text-[var(--dpf-muted)]">
            <ActivityEvidenceFact label="Adapter run" value={activity.adapterTelemetryId ? "Telemetry recorded" : "No telemetry yet"} />
            <ActivityEvidenceFact label="Tuning" value={activity.tuningRecommendation ?? "observe"} />
            <ActivityEvidenceFact label="Approved override" value={activity.approvedConfidenceOverrideId ? "Approved" : "None"} />
          </dl>
          <TechnicalDetails
            entries={[
              { label: "Recipe key", value: activity.harnessRecipeKey },
              { label: "Adapter run", value: activity.adapterTelemetryId },
              { label: "Override", value: activity.approvedConfidenceOverrideId },
            ]}
          />
        </div>

        {activity.exclusions.length > 0 ? (
          <div className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--dpf-muted)]">
              Alternatives excluded
            </p>
            <ul className="mt-2 space-y-1 text-xs leading-5 text-[var(--dpf-muted)]">
              {activity.exclusions.slice(0, 3).map((exclusion, index) => (
                <li key={`${activity.activityId}:decision-exclusion:${index}`}>
                  <span className="text-[var(--dpf-text)]">
                    {presentModelRoute(exclusion.providerId, exclusion.modelId).label}:
                  </span>{" "}
                  {exclusion.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="p-3 text-xs leading-5 text-[var(--dpf-muted)]">
            No alternatives were excluded for this route.
          </p>
        )}
      </div>
    </section>
  );
}

function ActivityEvidenceFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-[var(--dpf-muted)]">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium text-[var(--dpf-text)]">{value}</dd>
    </div>
  );
}

function EmptyStateStep({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
      <p className="text-xs font-semibold text-[var(--dpf-text)]">{label}</p>
      <p className="mt-1 text-xs leading-5 text-[var(--dpf-muted)]">{detail}</p>
    </div>
  );
}

function InspectorFact({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2" title={title}>
      <dt className="text-[10px] uppercase tracking-[0.14em] text-[var(--dpf-muted)]">{label}</dt>
      <dd className="mt-1 break-words font-medium text-[var(--dpf-text)]">{value}</dd>
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

function activitySignalClass(signal: OperationsMapActivityRouting["activities"][number]["successSignal"]): string {
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

function activityFlowConnectorClass(signal: OperationsMapActivityRouting["activities"][number]["successSignal"]): string {
  switch (signal) {
    case "failed":
      return "text-[var(--dpf-error)] [&_span]:border-[var(--dpf-error)]";
    case "attention":
    case "retried":
      return "text-[var(--dpf-warning)] [&_span]:border-[var(--dpf-warning)]";
    case "accepted":
    case "review-passed":
    case "valid":
      return "text-[var(--dpf-success)] [&_span]:border-[var(--dpf-success)]";
    case "unknown":
      return "text-[var(--dpf-muted)] [&_span]:border-[var(--dpf-border)]";
    default: {
      const exhaustive: never = signal;
      return exhaustive;
    }
  }
}

function activityFlowConfidenceClass(
  confidence: OperationsMapActivityRouting["activities"][number]["confidence"],
): string {
  switch (confidence) {
    case "trusted":
      return "border-[var(--dpf-success)] bg-[color-mix(in_srgb,var(--dpf-success)_10%,var(--dpf-surface-1))] text-[var(--dpf-text)]";
    case "degraded":
      return "border-[var(--dpf-error)] bg-[color-mix(in_srgb,var(--dpf-error)_10%,var(--dpf-surface-1))] text-[var(--dpf-text)]";
    case "calibrating":
      return "border-[var(--dpf-info)] bg-[color-mix(in_srgb,var(--dpf-info)_10%,var(--dpf-surface-1))] text-[var(--dpf-text)]";
    case "provisional":
      return "border-[var(--dpf-warning)] bg-[color-mix(in_srgb,var(--dpf-warning)_10%,var(--dpf-surface-1))] text-[var(--dpf-text)]";
    case null:
      return "border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-muted)]";
    default: {
      const exhaustive: never = confidence;
      return exhaustive;
    }
  }
}

function activityFlowRiskClass(risk: OperationsMapActivityRouting["activities"][number]["riskClass"]): string {
  switch (risk) {
    case "critical":
      return "border-[var(--dpf-error)] bg-[color-mix(in_srgb,var(--dpf-error)_10%,var(--dpf-surface-1))] text-[var(--dpf-text)]";
    case "high":
      return "border-[var(--dpf-warning)] bg-[color-mix(in_srgb,var(--dpf-warning)_10%,var(--dpf-surface-1))] text-[var(--dpf-text)]";
    case "medium":
      return "border-[var(--dpf-accent)] bg-[var(--dpf-accent-soft)] text-[var(--dpf-text)]";
    case "low":
      return "border-[var(--dpf-success)] bg-[color-mix(in_srgb,var(--dpf-success)_10%,var(--dpf-surface-1))] text-[var(--dpf-text)]";
    default: {
      const exhaustive: never = risk;
      return exhaustive;
    }
  }
}

function activityDecisionPanelClass(signal: OperationsMapActivityRouting["activities"][number]["successSignal"]): string {
  switch (signal) {
    case "failed":
      return "border-[var(--dpf-error)] bg-[color-mix(in_srgb,var(--dpf-error)_8%,var(--dpf-surface-2))]";
    case "attention":
    case "retried":
      return "border-[var(--dpf-warning)] bg-[color-mix(in_srgb,var(--dpf-warning)_8%,var(--dpf-surface-2))]";
    case "accepted":
    case "review-passed":
    case "valid":
      return "border-[var(--dpf-success)] bg-[color-mix(in_srgb,var(--dpf-success)_8%,var(--dpf-surface-2))]";
    case "unknown":
      return "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)]";
    default: {
      const exhaustive: never = signal;
      return exhaustive;
    }
  }
}
