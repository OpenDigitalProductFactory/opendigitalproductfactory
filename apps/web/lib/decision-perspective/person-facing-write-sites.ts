// apps/web/lib/decision-perspective/person-facing-write-sites.ts
//
// Every platform write that puts something in front of a person, classified
// (BI-5CA6AB34, BI-271B8EEC Direction 2; WWMD DI-8037FE582F71).
//
// The rule: a DECISION reaches a person only with a qualifying kernel record,
// a DecisionInteraction the BI-74B2A8CD rule table routed to a person. Action
// approvals are routed by resolveEscalation on the envelope path
// (govern/authority/coworker-authority-decision.ts) and are not listed here.
// What is listed is each remaining write primitive and every caller of it:
//
//   decision-governed  it asks a person to decide; the named check refuses
//                      the write unless a qualifying record backs it.
//   notice             it informs (an incident, a failure, a stale job, an
//                      outbound report); there are no options to choose
//                      between, so there is nothing for the kernel to settle.
//   operator-override  it applies a person's own emergency choice.
//
// person-facing-write-sites.test.ts scans the source for each primitive, so a
// new caller fails the build until someone classifies it here.

export type PersonFacingClassification = "decision-governed" | "notice" | "operator-override";

export type PersonFacingWritePrimitive = {
  /** The exact call text the scan looks for. */
  call: string;
  classification: PersonFacingClassification;
  rationale: string;
  /** For decision-governed primitives: `<path from apps/web>#<text of the enforcing check>`. */
  enforcedBy?: string;
  /** Every source file (path from apps/web) that contains the call, with why it belongs here. */
  callers: Record<string, string>;
};

export const PERSON_FACING_WRITE_PRIMITIVES: readonly PersonFacingWritePrimitive[] = [
  {
    call: "escalationCapture.create(",
    classification: "decision-governed",
    rationale: "Captures a kernel decision for a person to rule on; humanCaptureOutcome refuses a record the rule table did not route to a person.",
    enforcedBy: "lib/decision-perspective/human-escalation.ts#export function humanCaptureOutcome",
    callers: {
      "lib/actions/decision-perspective.ts": "platform decision capture",
      "lib/actions/org-decision-capture.ts": "organization decision capture",
    },
  },
  {
    call: "proposeLeaveDecision(",
    classification: "decision-governed",
    rationale: "Recommends approve, deny or review of a leave request to its manager; refused unless a DecisionInteraction backs it, including a fired hard rail.",
    enforcedBy: "lib/workforce/leave/decide-proposal.ts#No kernel decision record backs this recommendation",
    callers: {
      "lib/workforce/leave/decide-proposal.ts": "the definition",
      "lib/mcp/packs/leave-decision-pack.ts": "propose_leave_decision tool",
    },
  },
  {
    call: "createPlatformIssueReport(",
    classification: "notice",
    rationale: "Files an issue report about something that happened (a stall, a failure, a regression, a user report); it offers no options to choose between.",
    callers: {
      "app/api/quality/report/route.ts": "user-submitted issue report",
      "lib/actions/feedback-support.ts": "support feedback report",
      "lib/actions/quality.ts": "quality issue report",
      "lib/assurance/remediation-merge-live.ts": "remediation did not land",
      "lib/build/escalate-build-to-human.ts": "build stalled at a review gate",
      "lib/mcp/packs/feedback-pack.ts": "report_quality_issue / submit_feedback",
      "lib/operate/coworker-regression-detector.ts": "coworker regression detected",
      "lib/operate/scheduled-jobs/staleness-escalation.ts": "scheduled job stale",
      "lib/quality/platform-issue-reports.ts": "the definition",
      "lib/queue/functions/build-pr-delivery-reconcile.ts": "PR delivery mismatch",
      "lib/queue/functions/index-integrity-sweep.ts": "index integrity finding",
      "lib/queue/functions/log-signature-scanner.ts": "log signature finding",
    },
  },
  {
    call: "createTerminalWriterEscalation(",
    classification: "notice",
    rationale: "A machine signal to the calling agent to pick another reviewer provider for the same packet; one fixed action, no choice for a person.",
    callers: {
      "lib/mcp-task-execution.ts": "retry exhausted during execution",
      "lib/mcp-task-submit.ts": "retry exhausted at submit",
      "lib/mcp-task-terminal-writer-escalation.ts": "the definition",
    },
  },
  {
    call: "escalateReportUpstream(",
    classification: "notice",
    rationale: "Sends a consented bug or feedback report to the upstream maintainers; nothing is put to a local person to decide.",
    callers: {
      "lib/actions/feedback-escalation.ts": "the definition",
      "lib/ecosystem/submission-sweep-runner.ts": "submission sweep",
      "lib/mcp/packs/feedback-pack.ts": "escalate_feedback_upstream tool",
    },
  },
  {
    call: "escalateQuiescenceToForced(",
    classification: "operator-override",
    rationale: "Applies the operator's own Force now choice during an upgrade drain; the write is the outcome of a person's decision, not a request for one.",
    callers: {
      "lib/actions/promotions.ts": "Force now from the promotions surface",
      "lib/self-upgrade/drain-control.ts": "Force now from the drain control",
      "lib/self-upgrade/quiescence.ts": "the definition",
    },
  },
];
