import { Surface } from "@/components/ui/Surface";
import { ButtonLink } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/report-kit";
import type { ApprovalOutcome } from "@/lib/coworker/approval-outcome";
import { SOURCE_CATALOG } from "@dpf/i18n";

type Copy = Record<"result" | "recent" | "unavailable" | "details" | "open", string> & { inspectRoom?: string; roomUnavailable?: string; evidence?: string;
  runtimeEvidence?: string; hostUnproven?: string; hostVerified?: string;
  serviceReport?: Pick<typeof SOURCE_CATALOG.approvals.serviceReport, "evidence" | "target" | "observedAt" | "outcome" | "outcomes" | "groups" | "none"> };

/** Read-only history; these are not fresh decisions and do not enter the queue. */
/** `onBehalfText`: "Decided by ADMIN on behalf of OWNER: REASON", formatted by the page (BI-7BCC87BB). */
export function ApprovalOutcomeHistory({ outcomes, exact = false, copy = SOURCE_CATALOG.approvals }: { outcomes: Array<ApprovalOutcome & { onBehalfText?: string }>; exact?: boolean; copy?: Copy }) {
  if (!outcomes.length && !exact) return null;
  const reportCopy = copy.serviceReport ?? SOURCE_CATALOG.approvals.serviceReport;
  return (
    <details id="approval-result" open={exact} className="scroll-mt-4">
      <summary className="cursor-pointer py-3 text-dpf-body font-dpf-medium text-dpf-text">
        {exact ? copy.result : copy.recent}
      </summary>
      <div className="space-y-3">
        {!outcomes.length ? <p className="text-dpf-body text-dpf-muted">{copy.unavailable}</p> : null}
        {outcomes.map((outcome) => (
          <Surface key={outcome.envelopeId} padding="sm" rounded="md">
            <StatusBadge label={outcome.label} intent={outcome.state === "executed" ? "success" : "neutral"} />
            {outcome.failureExplanation ? <p className="mt-2 text-dpf-body text-dpf-text">{outcome.failureExplanation}</p> : null}
            {outcome.runtimeExplanation ? <p className="mt-2 text-dpf-body text-dpf-text">{outcome.runtimeExplanation}</p> : null}
            {outcome.serviceReportExplanation ? <p className="mt-2 text-dpf-body text-dpf-text">{outcome.serviceReportExplanation}</p> : null}
            <p className="mt-2 text-dpf-body text-dpf-text">{outcome.nextAction}</p>
            {outcome.failureEvidence?.state === "available" ? outcome.failureEvidence.roomHref
              ? <ButtonLink variant="ghost" className="mt-2 min-h-11" href={outcome.failureEvidence.roomHref}>{copy.inspectRoom ?? SOURCE_CATALOG.approvals.failure.inspectRoom}</ButtonLink>
              : <p className="mt-2 text-dpf-caption text-dpf-muted">{copy.roomUnavailable ?? SOURCE_CATALOG.approvals.failure.roomUnavailable}</p> : null}
            {outcome.onBehalfText ? <p className="mt-1 text-dpf-body text-dpf-muted">{outcome.onBehalfText}</p> : null}
            <details className="mt-2 text-dpf-caption text-dpf-muted">
              <summary className="cursor-pointer py-2">{copy.details}</summary>
              <p className="break-all">{outcome.envelopeId}</p>
              <time dateTime={outcome.createdAtIso}>{outcome.createdAtIso}</time>
              {outcome.serviceReportEvidence?.state === "available" ? <div className="mt-2 space-y-2 break-words">
                <p>{reportCopy.evidence}: {outcome.serviceReportEvidence.executionId}</p>
                <p>{reportCopy.target}: <code>{outcome.serviceReportEvidence.report.targetSha}</code></p>
                <p>{reportCopy.observedAt}: <time dateTime={outcome.serviceReportEvidence.report.observedAtIso}>{outcome.serviceReportEvidence.report.observedAtIso}</time></p>
                <p>{reportCopy.outcome}: {reportCopy.outcomes[outcome.serviceReportEvidence.report.outcome]}</p>
                {Object.entries(outcome.serviceReportEvidence.report.classifications).map(([key, names]) => <p key={key}>
                  {reportCopy.groups[key as keyof typeof reportCopy.groups]}: <span>{names.length ? names.join(", ") : reportCopy.none}</span>
                </p>)}
              </div> : null}
              {outcome.failureEvidence?.state === "available" ? <p className="mt-2 break-words">
                {copy.evidence ?? SOURCE_CATALOG.approvals.failure.evidence}: {outcome.failureEvidence.executionId} · {outcome.failureEvidence.code} · {outcome.failureEvidence.executedAtIso}
              </p> : null}
              {outcome.runtimeEvidence?.state === "available" ? <p className="mt-2 break-words">
                {copy.runtimeEvidence ?? SOURCE_CATALOG.approvals.runtime.evidence}: {outcome.runtimeEvidence.executionId} · {outcome.runtimeEvidence.transitionId}
                {" · "}{outcome.runtimeEvidence.failureCode ?? outcome.runtimeEvidence.operationStatus}
                {" · "}{outcome.runtimeEvidence.hostEvidence.receiptVerification === "verified"
                  ? (copy.hostVerified ?? SOURCE_CATALOG.approvals.runtime.hostVerified)
                  : (copy.hostUnproven ?? SOURCE_CATALOG.approvals.runtime.hostUnproven)}
              </p> : null}
              <p><a className="underline" href={outcome.inboxHref}>{copy.open}</a></p>
            </details>
          </Surface>
        ))}
      </div>
    </details>
  );
}
