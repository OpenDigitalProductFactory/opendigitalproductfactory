"use server";

// Answer-once action behind the /coworker-decisions/review ask-when-silent loop (BI-3AAB96E9).
//
// When evaluate_org_business_decision defers because the org has no recorded
// stance, the gap surfaces here. Answering it once routes the confirmed answer
// through the same qa enricher the record_org_business_answer tool uses (draft
// by default), then resolves the cluster's unresolved deferrals so the finding
// clears — closing the loop instead of dead-ending at the manual stance editor.

import { prisma, Prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";

import { requireCapability, requireUserId } from "@/lib/actions/shared/guards";
import { approveHeldProfessionMaterial } from "@/lib/decision-perspective/held-material-store";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";
import { captureOrgBusinessAnswer } from "@/lib/wiki/capture-org-answer";
import { createProductionInference } from "@/lib/wiki/inference-adapter";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { ruleWeightAdjustmentProposal } from "@/lib/decision-perspective/weight-proposal-store";

export async function answerGovernanceGap(input: {
  domainClass: string;
  question: string;
  answer: string;
}): Promise<{ ok: boolean; message: string }> {
  const userId = await requireUserId();

  const question = (input.question ?? "").trim();
  const answer = (input.answer ?? "").trim();
  const domainClass = (input.domainClass ?? "").trim();
  if (!question || !answer) {
    return { ok: false, message: "Add your answer before capturing it." };
  }

  const org = await prisma.organization.findFirst({ select: { id: true } });
  if (!org) {
    return { ok: false, message: "No organization is configured for this install." };
  }
  const orgProfile = await prisma.decisionPerspectiveProfile.findFirst({
    where: { kind: "organization" },
    select: { profileId: true },
  });

  try {
    const result = await captureOrgBusinessAnswer({
      organizationId: org.id,
      question,
      answer,
      userId,
      infer: createProductionInference({ taskType: "wiki_proposal" }),
    });

    // Resolve the cluster's unresolved org deferrals so the gap clears. The
    // enriched pages are draft-pending-review, so the record here is that the
    // operator has *provided guidance*, not that the draft is authoritative.
    if (orgProfile && domainClass) {
      await prisma.decisionInteraction.updateMany({
        where: {
          profileId: orgProfile.profileId,
          domainClass,
          outcomeType: { in: ["defer", "escalate"] },
          humanOutcome: { equals: Prisma.DbNull },
        },
        data: {
          humanOutcome: {
            resolvedVia: "review-answer",
            rawSourceId: result.rawSourceId,
            answeredBy: userId,
          },
        },
      });
    }

    revalidatePath("/coworker-decisions/review");

    const drafts = result.committed.length;
    return {
      ok: true,
      message:
        drafts > 0
          ? `Captured. ${drafts} draft page(s) await your review before they become authoritative.`
          : "Captured your answer, but no reviewable knowledge could be extracted — try adding a little more detail.",
    };
  } catch (e) {
    return { ok: false, message: `Could not capture the answer: ${getErrorMessage(e)}` };
  }
}

// BI-D88DFEEA Phase 3 — rule on a weight-adjustment proposal. Never auto-
// applied (spec §2.4): accepting reaches `ruled`, the same tier name authored
// stance material reaches via stance-promotion.ts; rejecting reaches this
// model's own terminal `rejected` state so it stops resurfacing. This does
// NOT yet mutate any live composite score — that wiring is JSI Phase 4
// (founder review of the first real proposals before either is allowed to
// influence a decision), explicitly out of scope here.
export async function ruleWeightProposal(input: {
  proposalId: string;
  ruling: "accept" | "reject";
  rejectionReason?: string;
}): Promise<{ ok: boolean; message: string }> {
  const userId = await requireUserId();
  const result = await ruleWeightAdjustmentProposal(prisma, {
    proposalId: input.proposalId,
    ruling: input.ruling,
    ruledByUserId: userId,
    rejectionReason: input.rejectionReason,
  });

  if (!result.ok) {
    return {
      ok: false,
      message:
        result.error === "not-found"
          ? "That proposal no longer exists."
          : "Someone already ruled on this proposal.",
    };
  }

  revalidatePath("/coworker-decisions/review");
  return {
    ok: true,
    message:
      result.status === "ruled"
        ? "Accepted. Recorded at the ruled tier — this does not yet change any live decision score."
        : "Rejected. This proposal won't resurface.",
  };
}

/**
 * Release one profession family's craft doctrine from the high-stakes review
 * hold (BI-5F3BFD13).
 *
 * `manage_platform` rather than a bare session: this promotes doctrine that
 * then governs how a coworker decides, which is a platform-governance act, not
 * ordinary workspace editing. Failures are returned as data — a thrown server
 * action is redacted in production, so the operator would see nothing.
 */
export async function approveHeldMaterial(input: {
  profileId: string;
}): Promise<ActionResult<string>> {
  const { userId } = await requireCapability("manage_platform");

  const profileId = (input.profileId ?? "").trim();
  if (!profileId) {
    return err("No craft area was named.");
  }

  try {
    const result = await approveHeldProfessionMaterial(prisma, {
      profileId,
      approvedByUserId: userId,
    });

    if (!result.ok) {
      return err("Nothing is waiting for approval here — it may already be approved.");
    }

    revalidatePath("/coworker-decisions/review");
    const pages = `${result.data} ${result.data === 1 ? "page" : "pages"}`;
    return ok(`Approved. This coworker now decides with its own craft doctrine (${pages}).`);
  } catch (error) {
    return err(getErrorMessage(error));
  }
}
