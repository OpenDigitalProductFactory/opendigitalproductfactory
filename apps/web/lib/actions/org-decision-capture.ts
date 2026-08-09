"use server";
// WWWD org-decision capture (BI-9677364B, EP-0AF96937 build plan Phase 2).
//
// The non-build counterpart to captureDecisionInteraction: business decisions
// from the /coworker-business gate carry no buildId, so until now a founder
// answer taught the corpus NOTHING (candidateMaterial was read nowhere). This
// action records the owner's ruling on an escalated/deferred org decision and
// — when asked — writes it back as a STANDING stance: a published org-overlay
// page (embedded for the deliberation layer) plus a `ruled` (A/1.0) material
// in the decision's domainClass, so equivalent decisions resolve next time.
//
// Domain errors are RETURNED as values, never thrown — Next strips thrown
// messages in production ("use server" error-surfacing rule).

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";

import { prisma, Prisma } from "@dpf/db";
import { upsertWikiPage, appendRevision } from "@dpf/db/wiki-store";
import { requireCapability } from "@/lib/actions/shared/guards";
import { promoteStanceMaterial } from "@/lib/decision-perspective/stance-promotion";
import type { DecisionDomainClass } from "@/lib/decision-perspective/types";
import { storeWikiPage } from "@/lib/wiki/embeddings";
import { decisionReviewIdentity } from "@/lib/decision/review-identity";
import {
  buildStandingStancePage,
  validateOrgDecisionCapture,
  type OrgDecisionCaptureInput,
} from "@/lib/wiki/org-decision-capture";

export type CaptureOrgDecisionResult =
  | {
      ok: true;
      status: "captured" | "already-captured";
      /** Set when a standing stance was written. */
      standingSlug?: string;
      /** True when the standing material is gate-live in the decision's class. */
      standingPromoted?: boolean;
      /** Number of unresolved ledger occurrences closed by this one ruling. */
      resolvedCount: number;
      /** Non-fatal follow-on failure after the ruling itself was recorded. */
      warning?: string;
    }
  | { ok: false; error: string };

function captureId(prefix: "ESC" | "DEF"): string {
  return `${prefix}-${randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
}

/**
 * Record the owner's ruling on an unresolved WWWD business decision, and
 * optionally make it standing doctrine for the decision's class.
 */
export async function captureOrgDecisionOutcome(
  input: OrgDecisionCaptureInput,
): Promise<CaptureOrgDecisionResult> {
  let userId: string;
  try {
    userId = (await requireCapability("view_platform")).userId;
  } catch {
    return { ok: false, error: "You do not have access to answer decisions." };
  }

  const v = validateOrgDecisionCapture(input);
  if (!v.ok) {
    return { ok: false, error: v.error };
  }

  const row = await prisma.decisionInteraction.findUnique({
    where: { interactionId: v.interactionId },
    include: {
      escalationCapture: { select: { escalationId: true } },
      deferralCapture: { select: { deferralId: true } },
    },
  });

  if (!row) {
    return { ok: false, error: "Decision not found." };
  }
  if (row.buildId) {
    return { ok: false, error: "This is a build decision — answer it from the build workspace." };
  }
  if (row.outcomeType !== "escalate" && row.outcomeType !== "defer") {
    return { ok: false, error: "This decision was resolved by the gate and needs no answer." };
  }
  if (row.humanOutcome !== null || row.escalationCapture || row.deferralCapture) {
    return { ok: true, status: "already-captured", resolvedCount: 0 };
  }

  // BI-6DCF772F: a structured option pick must be one of the options this gate
  // scored — otherwise chosenOptionId would never resolve against scoredOptions.
  const rawScoredOptions = (row as { scoredOptions?: unknown }).scoredOptions;
  const scoredIds = Array.isArray(rawScoredOptions)
    ? (rawScoredOptions as Array<{ id?: unknown }>)
      .map((option) => option?.id)
      .filter((id): id is string => typeof id === "string")
    : [];
  if (v.chosenOptionId && !scoredIds.includes(v.chosenOptionId)) {
    return { ok: false, error: "The chosen option is not one of this decision's options." };
  }

  const org = await prisma.organization.findFirst({ select: { id: true } });
  if (!org) {
    return { ok: false, error: "No organization is configured for this install." };
  }

  const capturedAt = new Date().toISOString();
  const rationale = v.rationale ?? v.answer;
  const clusterCandidates = await prisma.decisionInteraction.findMany({
    where: {
      profileId: row.profileId,
      domainClass: row.domainClass,
      outcomeType: { in: ["defer", "escalate"] },
      buildId: null,
      routeContext: "/coworker-business",
      humanOutcome: { equals: Prisma.DbNull },
    },
    select: { id: true, profileId: true, domainClass: true, question: true },
  });
  const selectedReviewIdentity = decisionReviewIdentity(row);
  const clusterIds = clusterCandidates
    .filter((candidate) => decisionReviewIdentity(candidate) === selectedReviewIdentity)
    .map((candidate) => candidate.id);
  // The selected row came from the same unresolved query shape. Keep the
  // operation safe under a concurrent reviewer even if it disappeared between
  // reads: the selected id remains the capture target and update predicates
  // below still require an unresolved row.
  if (!clusterIds.includes(row.id)) clusterIds.push(row.id);

  try {
    await prisma.$transaction(async (tx) => {
      if (row.outcomeType === "escalate") {
        await tx.escalationCapture.create({
          data: {
            escalationId: captureId("ESC"),
            interactionId: row.id,
            resolverUserId: userId,
            prompt: row.question,
            answer: v.answer,
            criteria: [],
            rationale,
            objectionsResolved: [],
            domainClass: row.domainClass,
            candidateMaterial: v.makeStanding,
          },
        });
      } else {
        await tx.deferralCapture.create({
          data: {
            deferralId: captureId("DEF"),
            interactionId: row.id,
            domain: row.domainClass,
            gapReason: v.answer,
            suggestedSourceTypes: [],
            candidateMaterial: v.makeStanding,
          },
        });
      }
      await tx.decisionInteraction.update({
        where: { id: row.id },
        data: {
          chosenOptionId: v.chosenOptionId,
          humanOutcome: {
            type: row.outcomeType === "escalate" ? "escalation" : "deferral",
            answer: v.answer,
            rationale,
            candidateMaterial: v.makeStanding,
            resolverUserId: userId,
            capturedAt,
            clearsGate: row.outcomeType === "escalate",
            chosenOptionId: v.chosenOptionId,
            sourceInteractionId: row.interactionId,
          },
        },
      });
      const matchingIds = clusterIds.filter((id) => id !== row.id);
      if (matchingIds.length > 0) {
        await tx.decisionInteraction.updateMany({
          where: {
            id: { in: matchingIds },
            humanOutcome: { equals: Prisma.DbNull },
          },
          data: {
            humanOutcome: {
              type: "clustered-owner-answer",
              answer: v.answer,
              rationale,
              candidateMaterial: v.makeStanding,
              resolverUserId: userId,
              capturedAt,
              clearsGate: row.outcomeType === "escalate",
              chosenOptionId: null,
              sourceInteractionId: row.interactionId,
            },
          },
        });
      }
    });
  } catch (err) {
    return { ok: false, error: (err as Error).message || "Could not record the answer." };
  }

  let standingSlug: string | undefined;
  let standingPromoted: boolean | undefined;
  let warning: string | undefined;

  if (v.makeStanding) {
    const page = buildStandingStancePage({
      interactionId: row.interactionId,
      question: row.question,
      domainClass: row.domainClass as DecisionDomainClass,
      answer: v.answer,
      rationale: v.rationale,
      standingTitle: v.standingTitle,
    });

    try {
      const saved = (await upsertWikiPage(prisma, {
        organizationId: org.id,
        slug: page.slug,
        title: page.title,
        body: page.body,
        pageKind: "stance",
        status: "published",
        isKernel: false,
        abstract: page.abstract,
      })) as { id: string };

      await appendRevision(prisma, {
        pageId: saved.id,
        title: page.title,
        body: page.body,
        changeKind: "manual",
        changeSummary: `Standing answer captured from ${row.interactionId}`,
        createdById: userId,
      });

      // Deliberation layer: embed so coworkers retrieve the ruling as WWWD
      // context. Best-effort — the gate-live material below is the enforcement.
      await storeWikiPage({
        pageId: saved.id,
        slug: page.slug,
        title: page.title,
        body: page.body,
        abstract: page.abstract,
        pageKind: "stance",
        status: "published",
        isKernel: false,
        kernelVersion: null,
        organizationId: org.id,
        kernelPageId: null,
      });

      const promoted = await promoteStanceMaterial({
        db: prisma,
        organizationId: org.id,
        wikiPageId: saved.id,
        slug: page.slug,
        summary: page.abstract,
        domainClasses: page.domainClasses,
        tier: "ruled",
      });

      standingSlug = page.slug;
      standingPromoted = promoted.ok;
    } catch (err) {
      // The primary disposition already committed. Report the follow-on
      // failure as a warning, not a false failure that leaves the completed
      // card on screen and invites the owner to submit the same ruling again.
      warning = `Your answer was recorded, but saving it as a standing stance failed: ${(err as Error).message}`;
    }
  }

  revalidatePath("/coworker-decisions/review");
  revalidatePath("/coworker-decisions");
  return {
    ok: true,
    status: "captured",
    standingSlug,
    standingPromoted,
    resolvedCount: clusterIds.length,
    warning,
  };
}
