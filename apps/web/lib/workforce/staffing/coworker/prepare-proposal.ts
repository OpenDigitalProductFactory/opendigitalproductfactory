/**
 * AI Staffing Coworker — proposal preparation (EP-WORKFORCE-OPS / BI-4AD09A35
 * Phase 4). Spec §11 Phase 1: the coworker reads governed facts, runs
 * validation/optimization, compares options, and composes an AgentActionProposal
 * — but never publishes. This module is the pure composition step: it turns
 * DPF-validated solver options into the typed `parameters` payload for an
 * AgentActionProposal (actionType "staffing.publish_schedule"), selecting only
 * options DPF's own engine certified as publishable (spec §7.3).
 *
 * It is honest about infeasibility (spec §8.3): when no option is publishable it
 * returns a `no_feasible_schedule` proposal that explains the gap, rather than
 * fabricating a fill or silently dropping demand. The actual AgentActionProposal
 * row is written by the coworker runtime (thread/message context); this function
 * has no side effects.
 */
import type { ValidatedOption } from "../solver/validate-after-solve";

export const STAFFING_PUBLISH_ACTION = "staffing.publish_schedule";

/** A per-option summary the coordinator sees in the comparison view (spec §8.3). */
export type ProposalOptionSummary = {
  optionIndex: number;
  assignmentCount: number;
  unfilledShiftCount: number;
  score: number;
  /** Priced schedule-shape premiums (spec §9.4), summed in abstract units. */
  premiumUnits: number;
  publishable: boolean;
};

export type StaffingProposalPayload = {
  actionType: typeof STAFFING_PUBLISH_ACTION;
  parameters: {
    organizationId: string;
    proposalRunId: string;
    /** Every option, with only publishable ones offered for approval. */
    options: ProposalOptionSummary[];
    /** Index of the recommended (publishable, best-scoring) option, or null. */
    recommendedOptionIndex: number | null;
    /** True when NO option is publishable — the honest infeasible path. */
    noFeasibleSchedule: boolean;
  };
  /** Always false in Phase 1: composing a proposal never publishes (spec §11). */
  autoPublish: false;
};

function summarize(validated: ValidatedOption, index: number): ProposalOptionSummary {
  const premiumUnits = validated.evaluation.premiums.reduce((sum, p) => sum + p.units, 0);
  return {
    optionIndex: index,
    assignmentCount: validated.option.assignments.length,
    unfilledShiftCount: validated.option.unfilledShiftIds.length,
    score: validated.option.score,
    premiumUnits,
    publishable: validated.publishable,
  };
}

/**
 * Compose the proposal. `recommendedOptionIndex` is the publishable option with
 * the highest score and fewest unfilled shifts; ties break to the lower premium.
 * When nothing is publishable, `noFeasibleSchedule` is set and no option is
 * recommended.
 */
export function prepareStaffingProposal(input: {
  organizationId: string;
  proposalRunId: string;
  validatedOptions: ValidatedOption[];
}): StaffingProposalPayload {
  const options = input.validatedOptions.map(summarize);

  const publishable = options.filter((o) => o.publishable);
  let recommendedOptionIndex: number | null = null;
  if (publishable.length > 0) {
    const best = publishable.reduce((a, b) => {
      if (b.unfilledShiftCount !== a.unfilledShiftCount) {
        return b.unfilledShiftCount < a.unfilledShiftCount ? b : a;
      }
      if (b.score !== a.score) return b.score > a.score ? b : a;
      return b.premiumUnits < a.premiumUnits ? b : a;
    });
    recommendedOptionIndex = best.optionIndex;
  }

  return {
    actionType: STAFFING_PUBLISH_ACTION,
    parameters: {
      organizationId: input.organizationId,
      proposalRunId: input.proposalRunId,
      options,
      recommendedOptionIndex,
      noFeasibleSchedule: publishable.length === 0,
    },
    autoPublish: false,
  };
}
