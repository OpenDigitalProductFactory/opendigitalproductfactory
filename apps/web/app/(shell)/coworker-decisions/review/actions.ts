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

import { requireUserId } from "@/lib/actions/shared/guards";
import { captureOrgBusinessAnswer } from "@/lib/wiki/capture-org-answer";
import { createProductionInference } from "@/lib/wiki/inference-adapter";
import { getErrorMessage } from "@/lib/shared/get-error-message";

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
