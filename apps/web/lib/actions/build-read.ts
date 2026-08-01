"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";
import type { FeatureBuildRow } from "@/lib/feature-build-types";
import { normalizeHappyPathState } from "@/lib/feature-build-types";
import { PLAN_READINESS_DOMAIN_CLASS } from "@/lib/decision-perspective/types";
import {
  DECISION_INTERACTION_GATE_SELECT,
  decisionInteractionRowToGateView,
} from "@/lib/decision-perspective/view-model";
import {
  loadBuildStudioCustomerStatuses,
  type CapsuleFindManyDelegate,
  type CustomerStatusBuild,
} from "@/lib/build/customer-status-loader";
import type { BuildStudioCustomerStatus } from "@/lib/build/customer-status-projection";
import { businessBuildBriefFromRecord } from "@/lib/build/business-build-brief";

export async function getFeatureBuildCustomerStatus(
  buildId: string,
): Promise<BuildStudioCustomerStatus | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: { id: true, buildId: true, title: true, phase: true, updatedAt: true },
  });
  if (!build) return null;

  const statuses = await loadBuildStudioCustomerStatuses(
    prisma as unknown as CapsuleFindManyDelegate,
    [{ ...build, phase: build.phase as CustomerStatusBuild["phase"] }],
  );
  return statuses[build.id] ?? null;
}
export async function getFeatureBuild(buildId: string): Promise<FeatureBuildRow | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    include: {
      businessBuildBrief: true,
      digitalProduct: { select: { productId: true, version: true } },
      originator: {
        select: {
          id: true,
          itemId: true,
          title: true,
          status: true,
          triageOutcome: true,
          effortSize: true,
          proposedOutcome: true,
          activeBuildId: true,
          resolution: true,
          abandonReason: true,
        },
      },
      activities: { orderBy: { createdAt: "desc" }, take: 50 },
      phaseHandoffs: { orderBy: { createdAt: "asc" }, select: { fromPhase: true, toPhase: true, fromAgentId: true, toAgentId: true, summary: true, decisionsMade: true, openIssues: true, userPreferences: true, compressedSummary: true, evidenceDigest: true, createdAt: true } },
      decisionInteractions: {
        where: {
          phaseFrom: "plan",
          phaseTo: "build",
          domainClass: PLAN_READINESS_DOMAIN_CLASS,
        },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: DECISION_INTERACTION_GATE_SELECT,
      },
    },
  });

  // Authorization: require an authenticated session, not specific ownership.
  // Build Studio is internal-cockpit-only and DPF is single-org-per-install,
  // so any authenticated user on this install can view any build in the org.
  // The previous ownership check hid builds promoted via MCP under a different
  // identity from the portal-logged-in user (BI-AA03296D). The list query
  // in apps/web/lib/feature-build-data.ts:getFeatureBuilds was relaxed in the
  // same PR for the same reason.
  if (!build) return null;

  return {
    ...build,
    brief: build.brief as FeatureBuildRow["brief"],
    businessBuildBrief: build.businessBuildBrief
      ? businessBuildBriefFromRecord({ title: build.title, row: build.businessBuildBrief })
      : null,
    plan: build.plan as FeatureBuildRow["plan"],
    phase: build.phase as FeatureBuildRow["phase"],
    draftApprovedAt: build.draftApprovedAt,
    designDoc: build.designDoc as FeatureBuildRow["designDoc"],
    designReview: build.designReview as FeatureBuildRow["designReview"],
    buildPlan: build.buildPlan as FeatureBuildRow["buildPlan"],
    planReview: build.planReview as FeatureBuildRow["planReview"],
    taskResults: build.taskResults as FeatureBuildRow["taskResults"],
    verificationOut: build.verificationOut as FeatureBuildRow["verificationOut"],
    acceptanceMet: build.acceptanceMet as FeatureBuildRow["acceptanceMet"],
    happyPathState: normalizeHappyPathState((build.plan as Record<string, unknown> | null)?.happyPathState ?? null),
    deliberationSummary:
      build.deliberationSummary as FeatureBuildRow["deliberationSummary"],
    product: build.digitalProduct
      ? { productId: build.digitalProduct.productId, version: build.digitalProduct.version, backlogCount: 0 }
      : null,
    originator: build.originator,
    phaseHandoffs: build.phaseHandoffs.map(h => ({
      ...h,
      evidenceDigest: h.evidenceDigest as Record<string, string>,
    })),
    decisionInteraction: decisionInteractionRowToGateView(build.decisionInteractions[0] ?? null),
  } as FeatureBuildRow;
}
