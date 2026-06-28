import type {
  CoworkerCapabilityNeedReview,
  CoworkerCapabilityNeedReviewItem,
} from "@/lib/coworker-self-assessment/review-service";
import type {
  WorkPatternReadModel,
  WorkPatternSummary,
} from "@/lib/tak/work-pattern-read-model";
import { reviewWorkPatternAction } from "@/lib/actions/work-pattern-review";
import { LocalTime } from "@/components/ui/LocalTime";
import { Chip, deepLink, EmptyState, Section } from "./panels";

type ShadowEvaluation = NonNullable<WorkPatternSummary["shadowEvaluation"]>;
type CaseStaging = NonNullable<WorkPatternSummary["caseStaging"]>;
type ImprovementTotals = ShadowEvaluation["improvementTotals"];
type DeltaKey = keyof ImprovementTotals;

const shadowDecisionLabels: Record<ShadowEvaluation["decision"], string> = {
  "approve-narrower-scope": "approve narrower scope",
  "continue-shadow": "continue shadow",
  "insufficient-evidence": "insufficient evidence",
  "reject-candidate": "reject candidate",
};

const deltaLabels: Record<DeltaKey, string> = {
  contextTokenDelta: "context tokens",
  failureDelta: "failures",
  manualTouchDelta: "manual touches",
  reviewFailureDelta: "review failures",
  toolCallDelta: "tool calls",
};

export function NeedsAndPlaybooksPanel({
  needs,
  workPatterns,
  canWrite,
}: {
  needs: CoworkerCapabilityNeedReview;
  workPatterns: WorkPatternReadModel;
  canWrite: boolean;
}) {
  const visibleNeeds = needs.needs.slice(0, 5);
  return (
    <div>
      <Section
        title="Open needs"
        count={needs.summary.total}
        action={deepLink("/ops?origin=capability-need", "Review queue")}
      >
        {visibleNeeds.length > 0 ? (
          <div style={{ display: "grid", gap: 8 }}>
            {visibleNeeds.map((need) => (
              <NeedRow key={need.needId} need={need} />
            ))}
          </div>
        ) : (
          <EmptyState text="No open needs recorded for this coworker." />
        )}
      </Section>

      <Section title="Living Playbooks" count={workPatterns.summary.totalPatterns}>
        {workPatterns.patterns.length > 0 ? (
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              <Chip tone="accent">{workPatterns.summary.totalObservedRuns} observed runs</Chip>
              <Chip tone={workPatterns.summary.openNeedCount > 0 ? "warning" : "muted"}>
                {workPatterns.summary.openNeedCount} open needs
              </Chip>
              <Chip tone="muted">{workPatterns.summary.readyForReviewCount} review-ready</Chip>
              <Chip tone="muted">{workPatterns.summary.candidateOnlyCount} candidate-only</Chip>
            </div>
            {workPatterns.patterns.slice(0, 8).map((pattern) => (
              <PlaybookRow
                key={`${pattern.patternKey}:${pattern.routeContext ?? ""}:${pattern.riskClass ?? ""}`}
                pattern={pattern}
                canWrite={canWrite}
              />
            ))}
          </div>
        ) : (
          <EmptyState text="No Living Playbook candidates recorded for this coworker." />
        )}
      </Section>
    </div>
  );
}

function NeedRow({ need }: { need: CoworkerCapabilityNeedReviewItem }) {
  const severityTone =
    need.severity === "blocker" ? "error" : need.severity === "important" ? "warning" : "muted";
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        gap: 10,
        padding: "8px 10px",
        borderRadius: 6,
        border: "1px solid var(--dpf-border)",
        background: "var(--dpf-surface)",
        alignItems: "start",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 4 }}>
          <Chip tone={severityTone}>{need.kind}</Chip>
          <Chip tone="muted">{need.status}</Chip>
          {need.routeContext ? <Chip tone="accent">{need.routeContext}</Chip> : null}
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--dpf-text)", overflowWrap: "anywhere" }}>
          {need.need}
        </div>
        <div style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 2, overflowWrap: "anywhere" }}>
          {need.blocks}
        </div>
      </div>
      <div style={{ display: "grid", gap: 4, justifyItems: "end", minWidth: 92 }}>
        <span style={{ fontSize: 10, color: "var(--dpf-muted)" }}>{need.createdAtLabel}</span>
        {need.linkedBacklogItemId ? <Chip tone="success">{need.linkedBacklogItemId}</Chip> : null}
      </div>
    </div>
  );
}

function PlaybookRow({ pattern, canWrite }: { pattern: WorkPatternSummary; canWrite: boolean }) {
  const statusTone =
    pattern.status === "active" ? "success" : pattern.status === "candidate" ? "warning" : "accent";
  const blockerLabel =
    pattern.readiness.blockers.length > 0
      ? pattern.readiness.blockers.slice(0, 2).join(", ")
      : "ready for review";
  return (
    <div
      style={{
        padding: "9px 10px",
        borderRadius: 6,
        border: "1px solid var(--dpf-border)",
        background: "var(--dpf-surface)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 260px", minWidth: 0 }}>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 5 }}>
            <Chip tone={statusTone}>{pattern.status}</Chip>
            <Chip tone="muted">{pattern.scope}</Chip>
            {pattern.routeContext ? <Chip tone="accent">{pattern.routeContext}</Chip> : null}
            {pattern.riskClass ? <Chip tone="warning">{pattern.riskClass}</Chip> : null}
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--dpf-text)", overflowWrap: "anywhere" }}>
            {pattern.candidate?.need ?? pattern.patternKey}
          </div>
          <div style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 2, overflowWrap: "anywhere" }}>
            {pattern.candidate?.blocks ?? pattern.patternKey}
          </div>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(58px, 1fr))",
            gap: 6,
            flex: "0 1 240px",
          }}
        >
          <PlaybookStat label="runs" value={String(pattern.observedRuns)} />
          <PlaybookStat label="done" value={String(pattern.completedRuns)} />
          <PlaybookStat label="failed" value={String(pattern.failedRuns)} />
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 7 }}>
        <Chip tone={pattern.openNeedCount > 0 ? "warning" : "muted"}>
          {pattern.openNeedCount} open needs
        </Chip>
        <Chip tone="muted">{pattern.evidenceRefs.length} evidence refs</Chip>
        <Chip tone={pattern.readiness.readyForReview ? "success" : "warning"}>{blockerLabel}</Chip>
        {pattern.latestObservedAt ? (
          <span style={{ fontSize: 10, color: "var(--dpf-muted)", marginLeft: "auto" }}>
            latest <LocalTime value={pattern.latestObservedAt} mode="date" />
          </span>
        ) : null}
      </div>
      {pattern.shadowEvaluation ? (
        <ShadowEvidenceRow evaluation={pattern.shadowEvaluation} />
      ) : null}
      <PlaybookReviewRow pattern={pattern} canWrite={canWrite} />
    </div>
  );
}

function ShadowEvidenceRow({ evaluation }: { evaluation: ShadowEvaluation }) {
  const agreement =
    evaluation.agreementRate == null
      ? "agreement pending"
      : `${Math.round(evaluation.agreementRate * 100)}% agreement`;
  const decision = shadowDecisionLabels[evaluation.decision];
  return (
    <div
      style={{
        display: "grid",
        gap: 5,
        marginTop: 8,
        padding: "7px 8px",
        borderRadius: 5,
        border: "1px solid var(--dpf-border)",
        background: "var(--dpf-surface-1)",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
        <Chip tone="accent">Shadow evidence</Chip>
        <Chip tone="muted">{evaluation.samples} trials</Chip>
        <Chip tone={evaluation.agreementRate != null && evaluation.agreementRate >= 0.9 ? "success" : "warning"}>
          {agreement}
        </Chip>
        <Chip tone={shadowDecisionTone(evaluation.decision)}>{decision}</Chip>
      </div>
      <div style={{ fontSize: 10, color: "var(--dpf-muted)", overflowWrap: "anywhere" }}>
        {trustRecommendationLabel(evaluation)}. {strongestReductionLabel(evaluation.improvementTotals)}
      </div>
    </div>
  );
}

function shadowDecisionTone(decision: ShadowEvaluation["decision"]) {
  if (decision === "approve-narrower-scope") return "success";
  if (decision === "reject-candidate") return "error";
  if (decision === "insufficient-evidence") return "warning";
  return "accent";
}

function trustRecommendationLabel(evaluation: ShadowEvaluation): string {
  const recommendation = evaluation.trustRecommendation;
  if (!recommendation) return "trust projection pending";
  if (recommendation.action === "hold") return `trust holds at ${recommendation.level}`;
  if (recommendation.action === "promote") {
    return `trust projection ${recommendation.from} to ${recommendation.to}`;
  }
  return `trust projection ${recommendation.from} down to ${recommendation.to}`;
}

function strongestReductionLabel(totals: ImprovementTotals): string {
  const strongest = (Object.entries(totals) as Array<[DeltaKey, number]>)
    .filter((entry) => entry[1] < 0)
    .sort((left, right) => left[1] - right[1])[0];
  if (!strongest) return "no measured reduction";
  const [key, value] = strongest;
  return `${deltaLabels[key]} ${Math.abs(value).toLocaleString()} lower`;
}

function PlaybookReviewRow({ pattern, canWrite }: { pattern: WorkPatternSummary; canWrite: boolean }) {
  if (pattern.reviewState) {
    const tone = reviewActionTone(pattern.reviewState.action);
    const caseStaging = pattern.caseStaging ?? pattern.reviewState.caseStaging ?? null;
    return (
      <div
        style={{
          display: "grid",
          gap: 5,
          marginTop: 8,
          padding: "7px 8px",
          borderRadius: 5,
          border: "1px solid var(--dpf-border)",
          background: "var(--dpf-surface-1)",
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
          <Chip tone="success">Decision recorded</Chip>
          <Chip tone={tone}>{reviewActionLabel(pattern.reviewState.action)}</Chip>
          <Chip tone="muted">{pattern.reviewState.decisionInteractionId}</Chip>
          {pattern.activationCandidate ? <Chip tone="accent">activation candidate</Chip> : null}
          <span style={{ fontSize: 10, color: "var(--dpf-muted)", marginLeft: "auto" }}>
            <LocalTime value={pattern.reviewState.reviewedAt} mode="date" />
          </span>
        </div>
        <div style={{ fontSize: 10, color: "var(--dpf-muted)", overflowWrap: "anywhere" }}>
          Candidate record only; live autonomy and Work Case state stay unchanged.
        </div>
        <CaseStagingRow state={caseStaging} />
      </div>
    );
  }

  const needId = pattern.linkedNeedIds[0];
  if (!canWrite || !needId || !pattern.shadowEvaluation) {
    return null;
  }

  const approvalEligible = pattern.shadowEvaluation.decision === "approve-narrower-scope";
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        alignItems: "center",
        marginTop: 8,
        padding: "7px 8px",
        borderRadius: 5,
        border: "1px solid var(--dpf-border)",
        background: "var(--dpf-surface-1)",
      }}
    >
      <Chip tone="accent">Review</Chip>
      {approvalEligible ? (
        <ReviewActionForm
          needId={needId}
          agentId={pattern.agentId}
          action="approve"
          label="Approve candidate"
          note="Approve as a scoped activation candidate; do not activate live autonomy."
        />
      ) : null}
      <ReviewActionForm
        needId={needId}
        agentId={pattern.agentId}
        action="defer"
        label="Defer"
        note="Defer this Living Playbook candidate for more shadow evidence."
      />
      <ReviewActionForm
        needId={needId}
        agentId={pattern.agentId}
        action="reject"
        label="Reject"
        note="Reject this Living Playbook candidate and retain the decision evidence."
      />
    </div>
  );
}

function CaseStagingRow({ state }: { state: CaseStaging | null }) {
  if (!state || state.status === "not-case-bound") return null;
  const staged = state.status === "stageable";
  const guardrail = caseStagingGuardrailLabel(state);
  return (
    <div
      style={{
        display: "grid",
        gap: 4,
        paddingTop: 6,
        borderTop: "1px solid var(--dpf-border)",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
        <Chip tone={staged ? "accent" : "warning"}>
          {staged ? "Work Case proposal staged" : "Case proposal blocked"}
        </Chip>
        {guardrail ? <Chip tone={staged ? "warning" : "error"}>{guardrail}</Chip> : null}
        {state.action ? <Chip tone="muted">{workCaseActionLabel(state.action)}</Chip> : null}
      </div>
      <div style={{ fontSize: 10, color: "var(--dpf-muted)", overflowWrap: "anywhere" }}>
        Proposal record only; the case waits for governed approval and receipt evidence before any commit.
      </div>
    </div>
  );
}

function caseStagingGuardrailLabel(state: CaseStaging): string | null {
  if (state.receiptCoverage === "required-before-commit") {
    return "receipt required before commit";
  }
  if (state.status === "blocked") {
    return caseStagingBlockerLabel(state.blockers[0]);
  }
  return null;
}

function caseStagingBlockerLabel(blocker: string | undefined): string {
  if (!blocker) return "proposal needs more context";
  const labels: Record<string, string> = {
    "missing-case-source-reference": "Work Case reference required",
    "missing-governed-action-key": "Work Case action required",
    "unknown-governed-action-key": "Work Case action not recognized",
    "missing-receipt-policy": "receipt policy required",
    "missing-authority-mode": "authority mode required",
    "missing-sponsor-principal": "sponsor required",
    "missing-authenticated-inbound-principal": "authenticated principal required",
    "policy-missing_agent_sponsor": "sponsor required",
    "policy-missing_delegating_principal": "delegating principal required",
    "policy-missing_authenticated_inbound_principal": "authenticated principal required",
  };
  return labels[blocker] ?? blocker.replaceAll("-", " ");
}

function workCaseActionLabel(action: string): string {
  const labels: Record<string, string> = {
    "needs-input": "needs input",
    "needs-auth": "needs authorization",
    propose: "propose next move",
    delegate: "delegate",
    handoff: "handoff",
    escalate: "escalate",
    verify: "verify",
    complete: "complete",
    cancel: "cancel",
    claim: "claim",
    pause: "pause",
    respond: "respond",
    resume: "resume",
  };
  return labels[action] ?? action.replaceAll("-", " ");
}

function ReviewActionForm({
  needId,
  agentId,
  action,
  label,
  note,
}: {
  needId: string;
  agentId: string;
  action: "approve" | "defer" | "reject";
  label: string;
  note: string;
}) {
  return (
    <form action={reviewWorkPatternAction} style={{ margin: 0 }}>
      <input type="hidden" name="needId" value={needId} />
      <input type="hidden" name="agentId" value={agentId} />
      <input type="hidden" name="action" value={action} />
      <input type="hidden" name="note" value={note} />
      <button
        type="submit"
        style={{
          appearance: "none",
          border: "1px solid var(--dpf-border-strong)",
          background: "var(--dpf-surface)",
          color: "var(--dpf-text)",
          borderRadius: 5,
          padding: "4px 8px",
          fontSize: 11,
          fontWeight: 600,
          cursor: "pointer",
          minHeight: 28,
        }}
      >
        {label}
      </button>
    </form>
  );
}

function reviewActionTone(action: "approve" | "defer" | "reject") {
  if (action === "approve") return "success";
  if (action === "reject") return "error";
  return "warning";
}

function reviewActionLabel(action: "approve" | "defer" | "reject"): string {
  if (action === "approve") return "approved";
  if (action === "reject") return "rejected";
  return "deferred";
}

function PlaybookStat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        minHeight: 40,
        padding: "6px 8px",
        borderRadius: 5,
        border: "1px solid var(--dpf-border)",
        background: "var(--dpf-surface-1)",
      }}
    >
      <div style={{ fontSize: 9, color: "var(--dpf-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </div>
      <div style={{ fontSize: 13, color: "var(--dpf-text)", fontWeight: 700 }}>{value}</div>
    </div>
  );
}
