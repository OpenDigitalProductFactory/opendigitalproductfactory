import { prisma } from "@dpf/db";
import { getErrorMessage } from "@/lib/shared/get-error-message";

/**
 * BI-C5D978E9 follow-up: attest the ideate research at REVIEW time, not only at
 * save time.
 *
 * The receipt was recorded in exactly one place — `saveBuildEvidence` with
 * field "designDoc". Any build whose design document was saved by another path,
 * or before that writer shipped, could therefore never obtain the receipt: the
 * reviewer passed, `RESEARCH_REQUIRED` blocked ideate->plan, the stranded-build
 * resumer re-ran the same review, and the build aged out at seven days.
 *
 * Live repro FB-7B4C714B — governed subject BI-CA7C0C48, a 4394-character
 * existingFunctionalityAudit and a 1677-character reusePlan, `reviewDesignDoc`
 * pass, and zero initiative_gate_receipt rows. It is one of 45 abandoned builds.
 *
 * Review is the honest place to attest: the reviewer has just read the document
 * and passed it. The write itself stays truthful — `recordIdeateResearchReceipt`
 * no-ops when the design records no research or the build has no governed
 * subject — so this only ever records what the design actually evidences, and
 * re-running a review is idempotent. Failure never breaks the review.
 */
export async function attestIdeateResearch(
  buildId: string,
  designDoc: unknown,
  userId: string,
  agentId: string | null,
): Promise<void> {
  let outcome: { recorded: boolean; reason: string };
  try {
    const { recordIdeateResearchReceipt } = await import("@/lib/build/record-ideate-research-receipt");
    outcome = await recordIdeateResearchReceipt({
      buildId,
      designDoc,
      revisionId: `review:${buildId}`,
      authorUserId: userId,
      authorAgentId: agentId,
    });
  } catch (err) {
    outcome = { recorded: false, reason: `attestation threw: ${getErrorMessage(err)}` };
  }
  // A missing receipt leaves the build exactly where it already was — but it
  // must never leave it there silently (BI-CA7C0C48: the swallowed refusal is
  // what made ten builds look stuck for no reason). The outcome is a build
  // activity row either way.
  await prisma.buildActivity.create({
    data: {
      buildId,
      tool: "ideate_research_attestation",
      summary: outcome.recorded
        ? "Research receipt recorded for the governed backlog subject (author-accountable lane)."
        : `Research receipt NOT recorded: ${outcome.reason.slice(0, 400)}`,
    },
  }).catch(() => undefined);
}
