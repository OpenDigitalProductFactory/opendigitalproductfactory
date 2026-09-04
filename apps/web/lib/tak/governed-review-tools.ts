// apps/web/lib/tak/governed-review-tools.ts
//
// BI-3907AF35 — a governed initiative review is review-phase work, and the
// agentic loop had no way to know that.
//
// The loop raises its wall-clock ceiling when executed tools reveal a heavy
// phase (build, ship, plan, ideate, review). None of the initiative-readiness
// tools appeared in any of those lists, so an independent reviewer fell to the
// 120-second conversation baseline.
//
// Live failure reviewing FB-EB292B9F for Second Chance Animal Rescue:
//
//   [agentic-loop] iter=6 provider=codex model=gpt-5.4 executedTools=4
//   [agentic-loop] nudging (tools used=4, short response, mentioned=none)
//   [agentic-loop] hit MAX_DURATION (120000ms). executedTools=4.
//   [agentic-loop] hit iteration ceiling (200). "may indicate the model needs more room"
//
// The reviewer read four tools' worth of design context and ran out of budget
// before it could write its verdict. No receipt, so the build stayed at
// "plan readiness: input-required" — and because spec-approval is
// `independent: true`, nobody else may record it.
//
// A governed review is not a chat turn. It reads an artifact at an immutable
// version, judges it, then writes a structured receipt carrying artifactRef,
// profile, artifactRole, findings and resolvedFindingRefs. Build Studio's own
// design generation is allowed ~150s for less.

/**
 * Tools whose use means the turn is performing a governed initiative review.
 *
 * `read_source_at_version` is included deliberately: it is the immutable reader
 * granted alongside the writers for exactly this work, and it is what the
 * reviewer spends its budget on BEFORE it can call a writer. Keying only on the
 * writers would raise the ceiling only after the reviewer had already run out
 * of time to reach one.
 */
const GOVERNED_REVIEW_TOOLS = new Set([
  "read_source_at_version",
  "record_initiative_evidence",
  "record_initiative_design_review",
  "record_initiative_architecture_review",
  "record_initiative_data_review",
  "record_initiative_ux_review",
  "record_initiative_security_review",
  "record_initiative_compliance_review",
  "record_initiative_domain_review",
  "record_initiative_archetype_review",
]);

/**
 * True when any executed tool marks this turn as a governed initiative review.
 *
 * Set membership rather than a prefix test: the lane table is a closed
 * vocabulary, and a prefix would silently capture any future record_initiative_*
 * tool whose budget has not actually been considered.
 */
export function usesGovernedReviewTools(
  executedTools: ReadonlyArray<{ name: string }>,
): boolean {
  return executedTools.some((tool) => GOVERNED_REVIEW_TOOLS.has(tool.name));
}
