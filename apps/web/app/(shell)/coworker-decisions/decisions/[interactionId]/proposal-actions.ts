"use server";

// Ruling on a drafted resolution from the decision record (BI-3D0FB84B).
//
// Two steps, in this order and never merged: record the human's ruling, then
// write it through. If the write-through fails, the ruling still stands and the
// owner is told what did not land — the alternative is a proposal that silently
// re-offers itself after someone already decided.
//
// Corpus answers keep landing as draft, exactly as the answer-once loop does.

import { prisma, Prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";

import { requireUserId } from "@/lib/actions/shared/guards";
import { captureOrgBusinessAnswer } from "@/lib/wiki/capture-org-answer";
import { createProductionInference } from "@/lib/wiki/inference-adapter";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { ruleWeightAdjustmentProposal } from "@/lib/decision-perspective/weight-proposal-store";
import {
  ALREADY_RULED,
  isProposalActionKind,
  NOT_FOUND,
  ruleResolutionProposal,
  type ProposalClient,
} from "@/lib/decision/resolution-proposal-store";
import { applyAcceptedProposal } from "@/lib/decision/resolution-write-through";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";
import {
  NO_ORGANIZATION,
  PROPOSAL_MESSAGES,
  recordedButNotApplied,
  WEIGHT_ALREADY_RULED,
  WEIGHT_MISSING,
} from "@/lib/decision/proposal-messages";

/** `data` is what to tell the owner on success; `error` is what to tell them otherwise. */
export type RuleProposalResult = ActionResult<string>;

export type RuleProposalInput = {
  proposalId: string;
  ruling: "accept" | "amend" | "reject";
  /** The edited text, for `amend`. Written into the draft's own field. */
  amendedText?: string;
  note?: string;
};

export async function ruleProposal(input: RuleProposalInput): Promise<RuleProposalResult> {
  const userId = await requireUserId();
  const db = prisma as unknown as ProposalClient;

  const row = await prisma.decisionResolutionProposal.findUnique({
    where: { proposalId: input.proposalId },
    select: {
      actionKind: true,
      draftPayload: true,
      interactionId: true,
      status: true,
    },
  });
  if (!row) return err(PROPOSAL_MESSAGES.missing);
  if (!isProposalActionKind(row.actionKind)) {
    return err(PROPOSAL_MESSAGES.unknownAction);
  }

  // The amendment edits one named field of the draft, so the rest of the
  // payload (the question being answered, the option ids) survives intact.
  let amendedPayload: Record<string, unknown> | undefined;
  if (input.ruling === "amend") {
    const text = (input.amendedText ?? "").trim();
    if (!text) return err(PROPOSAL_MESSAGES.needsWording);
    const draft = (row.draftPayload as Record<string, unknown> | null) ?? {};
    const field =
      row.actionKind === "no_change"
        ? "reason"
        : row.actionKind === "amend_stance"
          ? "body"
          : "answer";
    amendedPayload = { ...draft, [field]: text };
  }

  const ruled = await ruleResolutionProposal(db, {
    proposalId: input.proposalId,
    ruling: input.ruling,
    ruledByUserId: userId,
    amendedPayload,
    note: input.note,
  });
  if (!ruled.ok) {
    return err(
      ruled.error === ALREADY_RULED
        ? PROPOSAL_MESSAGES.alreadyRuled
        : ruled.error === NOT_FOUND
          ? PROPOSAL_MESSAGES.missing
          : PROPOSAL_MESSAGES.needsWording,
    );
  }

  if (input.ruling === "reject") {
    revalidatePath("/coworker-decisions/review");
    return ok(PROPOSAL_MESSAGES.rejected);
  }

  const org = await prisma.organization.findFirst({ select: { id: true } });

  try {
    const applied = await applyAcceptedProposal(
      {
        captureAnswer: async ({ question, answer }) => {
          if (!org) throw new Error(NO_ORGANIZATION);
          const result = await captureOrgBusinessAnswer({
            organizationId: org.id,
            question,
            answer,
            userId,
            infer: createProductionInference({ taskType: "wiki_proposal" }),
          });
          return { draftCount: result.committed.length };
        },
        adoptOption: async ({ interactionRowId, optionId, note }) => {
          await prisma.decisionInteraction.update({
            where: { id: interactionRowId },
            data: {
              chosenOptionId: optionId,
              humanOutcome: {
                resolvedVia: "resolution-proposal",
                chosenOptionId: optionId,
                answeredBy: userId,
                ...(note ? { note } : {}),
              },
            },
          });
        },
        ruleWeight: async ({ weightProposalId }) => {
          const result = await ruleWeightAdjustmentProposal(prisma, {
            proposalId: weightProposalId,
            ruling: "accept",
            ruledByUserId: userId,
          });
          if (result.ok) return { applied: true };
          return {
            applied: false,
            error: result.error === "not-found" ? WEIGHT_MISSING : WEIGHT_ALREADY_RULED,
          };
        },
        recordNoChange: async ({ interactionRowId, reason }) => {
          await prisma.decisionInteraction.update({
            where: { id: interactionRowId },
            data: {
              humanOutcome: {
                resolvedVia: "resolution-proposal",
                outcome: "no_change",
                reason,
                answeredBy: userId,
              },
            },
          });
        },
      },
      {
        actionKind: row.actionKind,
        payload: ruled.data.payload,
        interactionRowId: row.interactionId,
        note: input.note,
      },
    );

    revalidatePath("/coworker-decisions/review");
    // The ruling is recorded either way — say so rather than implying the
    // owner can simply try again from scratch.
    return applied.ok ? ok(applied.data) : err(recordedButNotApplied(applied.error));
  } catch (e) {
    return err(recordedButNotApplied(getErrorMessage(e)));
  }
}

/** Retire open suggestions for decisions that got answered somewhere else. */
export async function expireStaleProposals(): Promise<{ expired: number }> {
  await requireUserId();
  const resolved = await prisma.decisionInteraction.findMany({
    where: {
      humanOutcome: { not: Prisma.DbNull },
      resolutionProposals: { some: { status: "proposed", lifecycle: "active" } },
    },
    select: { id: true },
    take: 200,
  });
  if (resolved.length === 0) return { expired: 0 };
  const { count } = await prisma.decisionResolutionProposal.updateMany({
    where: { interactionId: { in: resolved.map((r) => r.id) }, status: "proposed", lifecycle: "active" },
    data: {
      lifecycle: "retired",
      lifecycleAt: new Date(),
      lifecycleReason: "decision resolved elsewhere",
    },
  });
  return { expired: count };
}
