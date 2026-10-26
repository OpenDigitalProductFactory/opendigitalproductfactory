"use client";

import { useEffect, useRef, useState } from "react";
import type { MessageKey } from "@dpf/i18n";
import { ExpandableCard } from "@/components/ui/report-kit/ExpandableCard";
import { useT } from "@/lib/i18n/use-t";
import type { FailedHandoffRecovery, RecordedWorkroomBlocker } from "@/lib/work-capsules/workroom-recovery-projection";
import type { NestedRoomCoordination } from "@/lib/work-management/nested-room-coordination";

const SETUP_HELP: Record<string, MessageKey<"workrooms">> = {
  "incomplete-responsibility-lineage": "nestedRecovery.setup.incompleteLineage",
  "responsibility-cycle": "nestedRecovery.setup.responsibilityCycle",
  "conflicting-responsibility-parents": "nestedRecovery.setup.conflictingParents",
  "conflicting-coordinators": "nestedRecovery.setup.conflictingCoordinators",
  "coordinator-not-recorded": "nestedRecovery.setup.missingCoordinator",
  "agent-escalation-cycle": "nestedRecovery.setup.agentCycle",
  "human-role-unfilled": "nestedRecovery.setup.unfilledRole",
  "human-role-conflict": "nestedRecovery.setup.conflictingRole",
  "role-holder-not-human": "nestedRecovery.setup.nonHumanHolder",
};

const HANDOFF_HELP: Record<string, MessageKey<"workrooms">> = {
  "handoff-authenticated-assistant-required": "nestedRecovery.handoff.sourceConnection",
  "handoff-identity-changed": "nestedRecovery.handoff.identityUnavailable",
  "handoff-completion-unproven": "nestedRecovery.handoff.historyUnavailable",
  "handoff-failure-lineage-unproven": "nestedRecovery.handoff.historyUnavailable",
  "handoff-request-invalid": "nestedRecovery.handoff.historyUnavailable",
  "handoff-request-unproven": "nestedRecovery.handoff.historyUnavailable",
  "handoff-room-not-found": "nestedRecovery.handoff.historyUnavailable",
  "handoff-build-dependency": "nestedRecovery.handoff.buildDependency",
  "handoff-policy-exemption-dependency": "nestedRecovery.handoff.policyDependency",
  "handoff-dependency-unavailable": "nestedRecovery.handoff.dependencyUnavailable",
  "handoff-clock-unavailable": "nestedRecovery.handoff.clockUnavailable",
  "handoff-verification-unavailable": "nestedRecovery.handoff.verificationUnavailable",
  "handoff-transaction-required": "nestedRecovery.handoff.governedPath",
  "handoff-unsupported-assistant": "nestedRecovery.handoff.controlledHandover",
  "handoff-recovery-packet-over-budget": "nestedRecovery.handoff.packetTooLarge",
  "handoff-boundary-changed": "nestedRecovery.handoff.boundaryChanged",
  "handoff-recovery-already-requested": "nestedRecovery.handoff.existingRequest",
  "handoff-recovery-already-completed": "nestedRecovery.handoff.existingCompletion",
  "handoff-receiver-mismatch": "nestedRecovery.handoff.receiverConnection",
  "authenticated-source-assistant-required": "nestedRecovery.handoff.sourceConnection",
  "handoff-source-changed": "nestedRecovery.handoff.sourceChanged",
  "handoff-current-write-authority-required": "nestedRecovery.handoff.authorityRequired",
  "handoff-canonical-identity-unavailable": "nestedRecovery.handoff.identityUnavailable",
  "handoff-original-operation-unproven": "nestedRecovery.handoff.historyUnavailable",
  "handoff-failure-history-ambiguous": "nestedRecovery.handoff.historyUnavailable",
  "handoff-history-unavailable": "nestedRecovery.handoff.historyUnavailable",
  "handoff-lineage-unavailable": "nestedRecovery.handoff.historyUnavailable",
  "handoff-completion-not-current": "nestedRecovery.handoff.historyUnavailable",
  "handoff-lease-expired": "nestedRecovery.handoff.leaseChanged",
  "handoff-lease-snapshot-changed": "nestedRecovery.handoff.leaseChanged",
  "workroom-prerequisite-unresolved": "nestedRecovery.handoff.prerequisite",
  "handoff-room-admission-required": "nestedRecovery.handoff.authorityRequired",
  "handoff-owner-required": "nestedRecovery.handoff.authorityRequired",
  "handoff-verification-lease-bound": "nestedRecovery.handoff.dependency",
  "handoff-lease-dependency": "nestedRecovery.handoff.dependency",
  "handoff-build-boundary": "nestedRecovery.handoff.controlledHandover",
  "handoff-restricted-boundary": "nestedRecovery.handoff.controlledHandover",
};

const BLOCKER_ID = "workroom-recorded-blocker";
const INSPECT_EVENT = "dpf:inspect-workroom-blocker";

/** A same-page inspection request carries no executable packet or authority. */
export function WorkroomBlockerInspectionLink() {
  const t = useT("workrooms");
  return <a href={"#" + BLOCKER_ID}
    onClick={(event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      window.dispatchEvent(new Event(INSPECT_EVENT));
    }}
    className="mt-2 inline-flex min-h-11 items-center rounded-md text-sm font-semibold text-[var(--dpf-accent)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]">
    {t("nestedRecovery.blocker.inspect")}
  </a>;
}

export function NestedRoomCoordinationPanel({ coordination, recordedBlocker, failedHandoffRecovery }: {
  coordination: NestedRoomCoordination | null;
  recordedBlocker?: RecordedWorkroomBlocker;
  failedHandoffRecovery?: FailedHandoffRecovery | null;
}) {
  const hasRecordedBlocker = Boolean(recordedBlocker);
  const [open, setOpen] = useState(false);
  const t = useT("workrooms");
  const escalation = coordination?.escalation;
  const needsSetup = escalation?.state === "setup-required";
  const blockerHeading = useRef<HTMLHeadingElement>(null);
  const [inspectionRequested, setInspectionRequested] = useState(false);
  useEffect(() => {
    const inspect = () => {
      if (hasRecordedBlocker && window.location.hash === `#${BLOCKER_ID}`) {
        setOpen(true);
        setInspectionRequested(true);
      }
    };
    inspect();
    const requestInspection = () => {
      if (!hasRecordedBlocker) return;
      setOpen(true);
      setInspectionRequested(true);
    };
    window.addEventListener("hashchange", inspect);
    window.addEventListener(INSPECT_EVENT, requestInspection);
    return () => {
      window.removeEventListener("hashchange", inspect);
      window.removeEventListener(INSPECT_EVENT, requestInspection);
    };
  }, [hasRecordedBlocker]);
  useEffect(() => {
    if (!open || !inspectionRequested || !blockerHeading.current) return;
    blockerHeading.current.focus();
    blockerHeading.current.scrollIntoView({ block: "nearest" });
    setInspectionRequested(false);
  }, [open, inspectionRequested]);
  return <div className="mt-4">
    <ExpandableCard id="nested-room-coordination" open={open} onOpenChange={setOpen}
      summary={<span>{t(needsSetup ? "nestedRecovery.needsAttention" : "nestedRecovery.summary")}</span>}>
      {recordedBlocker ? <section aria-labelledby={BLOCKER_ID} className="mb-4 min-w-0 [overflow-wrap:anywhere]">
        <h4 id={BLOCKER_ID} tabIndex={-1} ref={blockerHeading}
          className="text-sm font-semibold text-[var(--dpf-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]">{t("nestedRecovery.blocker.heading")}</h4>
        <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--dpf-text)]">
          {recordedBlocker.explanationState === "current" && recordedBlocker.explanation
            ? recordedBlocker.explanation
            : recordedBlocker.explanationState === "expired"
              ? t("nestedRecovery.blocker.expired")
              : t("nestedRecovery.blocker.unavailable")}
        </p>
        <p className="mt-2 text-sm text-[var(--dpf-muted)]">{t(failedHandoffRecovery ? "nestedRecovery.handoff.reportedAuthority" : "nestedRecovery.blocker.authority")}</p>
        <dl className="mt-3 space-y-2 text-sm">
          <div><dt className="text-[var(--dpf-muted)]">{t("nestedRecovery.blocker.source")}</dt><dd>{recordedBlocker.source.capsuleId ?? t("nestedRecovery.blocker.missing")}</dd></div>
          {recordedBlocker.expiresAt ? <div><dt className="text-[var(--dpf-muted)]">{t("nestedRecovery.blocker.expires")}</dt><dd><time dateTime={recordedBlocker.expiresAt}>{recordedBlocker.expiresAt}</time></dd></div> : null}
        </dl>
      </section> : null}
      {failedHandoffRecovery ? <section aria-labelledby="workroom-handoff-history" className="mb-4 min-w-0 [overflow-wrap:anywhere]">
        <h4 id="workroom-handoff-history" className="text-sm font-semibold text-[var(--dpf-text)]">{t("nestedRecovery.handoff.heading")}</h4>
        <p className="mt-2 text-sm text-[var(--dpf-text)]">{t(failedHandoffRecovery.state === "resolved" ? "nestedRecovery.handoff.resolved" : failedHandoffRecovery.state === "waiting" ? "nestedRecovery.handoff.waiting" : failedHandoffRecovery.state === "ready" ? "nestedRecovery.handoff.ready"  : HANDOFF_HELP[failedHandoffRecovery.reason] ?? "nestedRecovery.handoff.unavailable")}</p>
        <dl className="mt-3 space-y-2 text-sm text-[var(--dpf-text)]">
          {failedHandoffRecovery.owner ? <div><dt className="text-[var(--dpf-muted)]">{t("nestedRecovery.handoff.owner")}</dt><dd>{failedHandoffRecovery.owner.agentId}</dd><dd>{failedHandoffRecovery.owner.executorRef}</dd></div> : null}
          {failedHandoffRecovery.original ? <div><dt className="text-[var(--dpf-muted)]">{t("nestedRecovery.handoff.original")}</dt><dd>{failedHandoffRecovery.original.envelopeId}</dd><dd>{failedHandoffRecovery.original.executionId}</dd></div> : null}
          {failedHandoffRecovery.staleRequest ? <div><dt className="text-[var(--dpf-muted)]">{t("nestedRecovery.handoff.stale")}</dt><dd>{failedHandoffRecovery.staleRequest.requestId}</dd></div> : null}
          {failedHandoffRecovery.pending ? <div><dt className="text-[var(--dpf-muted)]">{t("nestedRecovery.handoff.receiver")}</dt><dd>{failedHandoffRecovery.pending.receiverRef}</dd><dd>{failedHandoffRecovery.pending.requestId}</dd></div> : null}
          {failedHandoffRecovery.resolution ? <div><dt className="text-[var(--dpf-muted)]">{t("nestedRecovery.handoff.completion")}</dt><dd>{failedHandoffRecovery.resolution.requestId}</dd><dd>{failedHandoffRecovery.resolution.activityId}</dd><dd><time dateTime={failedHandoffRecovery.resolution.recordedAt}>{failedHandoffRecovery.resolution.recordedAt}</time></dd></div> : null}
        </dl>
      </section> : null}
      {needsSetup ? <p className="mb-2 text-sm text-[var(--dpf-muted)]">
        {t(SETUP_HELP[escalation.reason] ?? "nestedRecovery.setup.incompleteRoute")}
      </p> : null}
      {coordination ? <><p className="mb-2 text-sm text-[var(--dpf-muted)]">
        {t("nestedRecovery.accountability")}
      </p>
      <p className="text-sm text-[var(--dpf-muted)]">{t("nestedRecovery.recordedRoute")}</p>
      {coordination.delegations.length ? <p className="mt-2 text-sm text-[var(--dpf-muted)]">
        {t("nestedRecovery.responsibility")}
      </p> : null}
      {escalation && escalation.steps.length ? <ol className="mt-2 list-decimal space-y-2 ps-5">
        {escalation.steps.map((step, index) => <li key={`${step.kind}:${step.ref}:${index}`} className="text-sm text-[var(--dpf-text)]">
          {step.displayName}
        </li>)}
      </ol> : null}</> : null}
    </ExpandableCard>
  </div>;
}
