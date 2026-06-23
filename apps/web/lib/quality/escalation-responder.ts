// ─── Escalation Responder — WWMD consult for a held escalation (BI-0ACD9AB2) ──
// The trusted receiving loop (design §5.3, §14): before a build-stall escalation
// reaches a human cold, route its blocker through the governed decision scopes.
// ~12 of every ~19 live escalations are kernel-commandment matters the planner
// missed (input validation = "never trust input"; authz = "least privilege";
// failing tests = TDD) — exactly what WWMD already mandates. The consult tells
// the operator whether the kernel can resolve the blocker (resume), it is not
// worth continuing (defer), or it is a genuine human decision.
//
// HITL-FIRST (dial-low, §14): the OPERATOR triggers this from the /ops attention
// lens and reviews the recommendation; the kernel advises, the human decides. An
// autonomous sweep (dial-up) layers on later, once a system responder principal
// is designed. This module is the pure request shape; the call + auth live in the
// server action (lib/actions/quality.ts consultEscalation).

import type {
  BuildStudioDecisionRequest,
  BuildStudioDecisionResult,
} from "@/lib/build/decision-service";

export type ConsultEscalationResult =
  | { ok: true; result: BuildStudioDecisionResult }
  | { ok: false; error: string };

export interface EscalationDecisionInput {
  reportId: string;
  title: string;
  description: string | null;
  selfFixClass: string | null;
  /** FeatureBuild.id (cuid) — carried into the decision trace context. */
  featureBuildId: string | null;
}

/** The three governed dispositions the responder weighs. Stable ids so the UI
 *  can label the kernel's recommendation; the descriptions are what the decision
 *  engine scores (semantic alignment against the principles). */
export const ESCALATION_DECISION_OPTIONS = [
  {
    id: "resume",
    operatorLabel: "Resume the build",
    description:
      "Resume the build — the blocker is resolvable by the governed scopes (for example a kernel commandment the planner missed: inject it as a hard plan requirement and re-plan), so no human judgement is required.",
  },
  {
    id: "defer",
    operatorLabel: "Defer or stop",
    description:
      "Defer or stop the build — it is not worth continuing now; park the work rather than spend more effort on it.",
  },
  {
    id: "escalate-human",
    operatorLabel: "Escalate to a human",
    description:
      "Escalate to a human — this is a genuine product or judgement call the governed scopes do not cover, so a person must decide.",
  },
] as const;

/**
 * Build the governed decision request for a held escalation. Pure.
 *
 * `source: "claude"` routes the consult to WWMD (the founder kernel) rather than
 * WWWD: the founder kernel is the scope the build reviewer already enforces and
 * where the relevant commandments (input-validation / least-privilege / TDD)
 * live, and the escalations are largely kernel-commandment matters.
 */
export function buildEscalationDecisionRequest(
  input: EscalationDecisionInput,
): BuildStudioDecisionRequest {
  const blocker = (input.description ?? input.title).slice(0, 1500);
  const selfFix = input.selfFixClass ? ` (self-fix class: ${input.selfFixClass})` : "";
  return {
    source: "claude",
    routeContext: "/ops",
    ...(input.featureBuildId ? { buildId: input.featureBuildId } : {}),
    question:
      `A build could not self-repair${selfFix} and was escalated: "${input.title}". ` +
      `Given the blocker below, should the build resume (the governed scopes can resolve it), ` +
      `be deferred/stopped, or is this a genuine human decision?\n\nBlocker:\n${blocker}`,
    options: ESCALATION_DECISION_OPTIONS.map((o) => ({
      id: o.id,
      description: o.description,
      operatorLabel: o.operatorLabel,
    })),
  };
}

/** Operator label for a recommended option id. Pure. */
export function escalationOptionLabel(optionId: string | undefined | null): string {
  const opt = ESCALATION_DECISION_OPTIONS.find((o) => o.id === optionId);
  return opt?.operatorLabel ?? "Review";
}

/** Short, operator-facing label for the consult's overall verdict. Pure. */
export function escalationConsultStatusLabel(status: string): string {
  switch (status) {
    case "recommended":
      return "Kernel recommends";
    case "needs-human":
      return "Needs human review";
    case "blocked":
      return "Blocked by a commandment";
    case "captured-gap":
      return "No governed decision";
    default:
      return "Consulted";
  }
}
