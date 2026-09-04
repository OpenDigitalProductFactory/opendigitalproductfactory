// What accepting a proposal actually writes (BI-3D0FB84B, EP-0AF96937).
//
// Every actionKind routes to a path that already existed before this feature.
// The proposal is a draft plus a lifecycle; it is not a new way to change
// doctrine, and it must never become one. Two rules hold here:
//
//   1. An org-corpus answer still lands as DRAFT, exactly as the answer-once
//      loop does today. Accepting a proposal records that the owner gave
//      guidance, not that the guidance is already authoritative.
//   2. An actionKind with no wired path REFUSES. It does not log-and-continue,
//      because a proposal that reports success while writing nothing is worse
//      than one that never existed.
//
// Spec: docs/superpowers/specs/2026-08-23-decision-concierge-design.md §4.4

import { err, ok, type ActionResult } from "@/lib/shared/action-result";

import type { ProposalActionKind } from "./resolution-proposal-store";

/** `data` is the sentence the owner is shown once the write lands. */
export type WriteThroughResult = ActionResult<string>;

/** Everything a write-through needs, injected so the mapping stays testable. */
export type WriteThroughDeps = {
  /** captureOrgBusinessAnswer, already bound to org + inference by the caller. */
  captureAnswer(input: { question: string; answer: string }): Promise<{ draftCount: number }>;
  /** Record the owner's chosen option against the decision. */
  adoptOption(input: { interactionRowId: string; optionId: string; note?: string }): Promise<void>;
  /** ruleWeightAdjustmentProposal at `ruled`. */
  ruleWeight(input: { weightProposalId: string }): Promise<{ applied: boolean; error?: string }>;
  /** Close the decision with a recorded reason and change nothing else. */
  recordNoChange(input: { interactionRowId: string; reason: string }): Promise<void>;
};

function asString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Apply an accepted proposal. `payload` is what the human actually accepted —
 * the amended text when they edited it, the draft when they did not — so this
 * function never reads the draft itself and cannot apply something nobody
 * approved.
 */
export async function applyAcceptedProposal(
  deps: WriteThroughDeps,
  input: {
    actionKind: ProposalActionKind;
    payload: Record<string, unknown>;
    interactionRowId: string | null;
    note?: string;
  },
): Promise<WriteThroughResult> {
  const { actionKind, payload } = input;

  switch (actionKind) {
    case "answer_gap": {
      const question = asString(payload, "question");
      const answer = asString(payload, "answer");
      if (!question || !answer) return err("The answer is missing its question or its text.");
      const { draftCount } = await deps.captureAnswer({ question, answer });
      return ok(
        draftCount > 0
          ? `Captured. ${draftCount} draft page(s) await your review before they become authoritative.`
          : "Captured your answer, but no reviewable knowledge could be extracted from it.",
      );
    }

    case "adopt_option": {
      const optionId = asString(payload, "optionId");
      if (!optionId) return err("The proposal names no option to adopt.");
      if (!input.interactionRowId) return err("Adopting an option needs the decision it belongs to.");
      await deps.adoptOption({ interactionRowId: input.interactionRowId, optionId, note: input.note });
      return ok(`Recorded "${optionId}" as your decision.`);
    }

    case "adjust_weight": {
      const weightProposalId = asString(payload, "weightProposalId");
      if (!weightProposalId) return err("The proposal names no weight adjustment.");
      const result = await deps.ruleWeight({ weightProposalId });
      return result.applied
        ? ok("Accepted at the ruled tier. This does not yet change any live decision score.")
        : err(result.error ?? "That weight adjustment could not be ruled on.");
    }

    case "no_change": {
      const reason = asString(payload, "reason");
      if (!reason) return err("A no-change ruling has to say why.");
      if (!input.interactionRowId) return err("Closing a decision needs the decision it belongs to.");
      await deps.recordNoChange({ interactionRowId: input.interactionRowId, reason });
      return ok("Closed with your reason recorded. Nothing else changed.");
    }

    // Designed, not yet wired. Refusing keeps the lifecycle honest: nothing
    // may reach `accepted` on a path that would write nothing.
    case "amend_stance":
    case "release_material":
      return err(
        `Accepting a ${actionKind} proposal is not wired yet — rule on it where that material lives.`,
      );
  }
}
