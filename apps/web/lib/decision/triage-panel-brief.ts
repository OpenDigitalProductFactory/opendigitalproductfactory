import type { TriageSubject } from "./triage-conductor";
import type { StaffingPlan } from "./triage-staffing";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
/**
 * The instruction the panel is convened on. Carries the decision, the options,
 * and — honestly — which professions are seated and which could not be, so the
 * adjudicator cannot claim expertise the roster does not have.
 */
export function buildPanelBrief(input: {
  subject: TriageSubject;
  plan: StaffingPlan;
  optionIds: string[];
}): string {
  const { subject, plan, optionIds } = input;
  const seated = plan.families.length
    ? plan.families.map((f) => f.label).join(", ")
    : "none — no profession applied, so weigh this on general platform doctrine and say so";

  return [
    `A governed decision reached a human instead of being settled. Draft what the owner should do.`,
    ``,
    `Question: ${subject.question}`,
    `Options: ${optionIds.length ? optionIds.join(", ") : "none recorded"}`,
    `Why it came here: outcome ${subject.outcomeType}, risk ${subject.riskTier ?? "unrecorded"}.`,
    `Professions seated: ${seated}.`,
    `Staffing basis: ${plan.basis}`,
    `Recorded case: ${canonicalJson({ options: subject.options ?? optionIds, evidence: subject.evidenceBundle ?? null, sources: subject.sources ?? null, profileVersionId: subject.profileVersionId ?? null })}`,
    ``,
    `Return ONLY a JSON object with these keys:`,
    `  recommendedAction: "answer_gap" | "adopt_option" | "no_change"`,
    `  draft: { answer } for answer_gap, { optionId } for adopt_option, { reason } for no_change`,
    `  summary: one line naming what the owner is being asked to accept`,
    `  consequences: [{ optionId, text }] — one line per option`,
    `  dissent: [{ role, position, because }] — empty only if the panel truly agreed`,
    `  confidence: 0..1`,
    ``,
    `If the panel cannot ground a recommendation, return {"recommendedAction":"no_change","draft":{"reason":"..."},...}`,
    `only when changing nothing is genuinely the right call. Otherwise say so in the run's consensus state`,
    `rather than drafting something nobody can support.`,
  ].join("\n");
}
