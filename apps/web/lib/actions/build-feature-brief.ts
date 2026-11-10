"use server";

import { requireCapability } from "@/lib/actions/shared/guards";
import {
  businessBriefJsonPayload,
} from "@/lib/build/build-actions-core";
import {
  legacyFeatureBuildBriefToBusinessBuildBriefInput,
} from "@/lib/build/business-build-brief";
import {
  type FeatureBrief,
  validateFeatureBrief,
} from "@/lib/feature-build-types";
import { prisma, type Prisma } from "@dpf/db";

export async function updateFeatureBrief(
  buildId: string,
  brief: FeatureBrief,
  options: { actorUserId?: string } = {},
): Promise<void> {
  const userId = options.actorUserId
    ?? (await requireCapability("view_platform")).userId;

  const build = await prisma.featureBuild.findUnique({ where: { buildId } });
  if (!build) throw new Error("Build not found");
  if (build.createdById !== userId) throw new Error("Forbidden");
  if (build.phase !== "ideate") {
    throw new Error("Brief can only be updated during Ideate phase");
  }

  const validation = validateFeatureBrief(brief);
  if (!validation.valid) throw new Error(validation.errors.join(", "));

  const organization = await prisma.organization.findFirst({ select: { id: true } });
  if (!organization) {
    throw new Error("Organization is required before saving a business build brief");
  }

  const businessBrief = legacyFeatureBuildBriefToBusinessBuildBriefInput({
    orgId: organization.id,
    buildId: build.buildId,
    featureBuildId: build.id,
    title: build.title,
    brief,
    submittedByUserId: userId,
  });
  const acceptedFields = businessBrief.status === "accepted"
    ? { acceptedByUserId: userId, acceptedAt: new Date() }
    : { acceptedByUserId: null, acceptedAt: null };
  const jsonPayload = businessBriefJsonPayload(businessBrief);

  await prisma.$transaction(async (tx) => {
    await tx.featureBuild.update({
      where: { buildId },
      data: { brief: brief as unknown as Prisma.InputJsonValue },
    });

    await tx.businessBuildBrief.upsert({
      where: { featureBuildId: build.id },
      create: { ...businessBrief, ...jsonPayload, ...acceptedFields },
      update: {
        status: businessBrief.status,
        intakeSource: businessBrief.intakeSource,
        capabilityPackId: businessBrief.capabilityPackId,
        backlogItemId: businessBrief.backlogItemId,
        businessOutcome: businessBrief.businessOutcome,
        affectedPeople: jsonPayload.affectedPeople,
        affectedWorkflow: businessBrief.affectedWorkflow,
        sourceEvidence: jsonPayload.sourceEvidence,
        successSignals: businessBrief.successSignals,
        constraints: businessBrief.constraints,
        businessInterpretation: businessBrief.businessInterpretation,
        technicalInterpretation: jsonPayload.technicalInterpretation,
        riskProfile: jsonPayload.riskProfile,
        hiveReadiness: jsonPayload.hiveReadiness,
        openQuestions: businessBrief.openQuestions,
        confidence: businessBrief.confidence,
        confidenceRationale: businessBrief.confidenceRationale,
        submittedByUserId: businessBrief.submittedByUserId,
        ...acceptedFields,
      },
    });
  });
}

