// apps/web/lib/build/decomposition-override.ts
//
// Phase 4a — operator "Keep as one build" override for required-tier
// decomposition recommendations.
// Spec: docs/superpowers/specs/2026-05-24-build-studio-design-time-decomposition-design.md
// BI: BI-2E6CC391.
//
// When sizeDesignDoc returns `decompose-required`, the operator can choose to
// proceed monolithically by recording an explicit one-line justification.
// Spec §12 Q1: "allowed, but must require a one-line justification and must
// be recorded in FeatureBuild.designReview.decompositionOverride".
//
// The override also writes the canonical atomic plan-backlog-coverage receipt
// on the originating BI, so Build Studio and external planning share one audit
// shape rather than treating the design-review JSON as a private exception.
//
// Override is only meaningful at the `decompose-required` tier; the
// `decompose-recommended` tier is single-click "keep as one build" per spec
// §4.1 — no override row is recorded. This module rejects override writes
// against ok / recommended assessments to keep the audit signal clean.

import { prisma } from "@dpf/db";
import type { ReviewResult } from "@/lib/explore/feature-build-types";

export type DecompositionOverride = {
  rationale: string;
  recordedAt: string;
  recordedByUserId: string;
  recordedByAgentId: string | null;
};

export type RecordDecompositionOverrideInput = {
  buildId: string;
  rationale: string;
  userId: string;
  agentId?: string | null;
  /** Test seam — override timestamp. */
  now?: () => Date;
  /** Test seam — replace prisma. */
  db?: RecordDecompositionOverrideDb;
};

export type RecordDecompositionOverrideResult =
  | { ok: true; override: DecompositionOverride }
  | { ok: false; code: RecordDecompositionOverrideErrorCode; error: string };

export type RecordDecompositionOverrideErrorCode =
  | "build-not-found"
  | "empty-rationale"
  | "no-size-assessment"
  | "override-not-applicable";

export type RecordDecompositionOverrideTx = {
  featureBuild: {
    findUnique: typeof prisma.featureBuild.findUnique;
    update: typeof prisma.featureBuild.update;
  };
  buildActivity: {
    create: typeof prisma.buildActivity.create;
  };
  backlogItemActivity: {
    create: typeof prisma.backlogItemActivity.create;
  };
};

export type RecordDecompositionOverrideDb = RecordDecompositionOverrideTx & {
  $transaction: <T>(fn: (tx: RecordDecompositionOverrideTx) => Promise<T>) => Promise<T>;
};

export async function recordDecompositionOverride(
  args: RecordDecompositionOverrideInput,
): Promise<RecordDecompositionOverrideResult> {
  const rationale = args.rationale.trim();
  if (rationale.length === 0) {
    return {
      ok: false,
      code: "empty-rationale",
      error: "Override rationale is required and must be non-empty.",
    };
  }

  const now = args.now ?? (() => new Date());
  const db: RecordDecompositionOverrideDb = args.db ?? {
    $transaction: (fn) => prisma.$transaction((tx) => fn(tx as unknown as RecordDecompositionOverrideTx)),
    featureBuild: {
      findUnique: prisma.featureBuild.findUnique.bind(prisma.featureBuild),
      update: prisma.featureBuild.update.bind(prisma.featureBuild),
    },
    buildActivity: {
      create: prisma.buildActivity.create.bind(prisma.buildActivity),
    },
    backlogItemActivity: {
      create: prisma.backlogItemActivity.create.bind(prisma.backlogItemActivity),
    },
  };

  const build = await db.featureBuild.findUnique({
    where: { buildId: args.buildId },
    select: { buildId: true, designReview: true, originatingBacklogItemId: true },
  });
  if (!build) {
    return {
      ok: false,
      code: "build-not-found",
      error: `FeatureBuild ${args.buildId} not found.`,
    };
  }

  const review = (build.designReview ?? null) as ReviewResult | null;
  const decision = review?.sizeAssessment?.decision ?? null;

  if (decision == null) {
    return {
      ok: false,
      code: "no-size-assessment",
      error: "No size assessment recorded on this build's designReview. Run reviewDesignDoc first.",
    };
  }
  if (decision !== "decompose-required") {
    return {
      ok: false,
      code: "override-not-applicable",
      error: `Override is only meaningful when size decision is "decompose-required"; current decision is "${decision}". For "decompose-recommended" the operator proceeds without recording an override.`,
    };
  }

  const override: DecompositionOverride = {
    rationale,
    recordedAt: now().toISOString(),
    recordedByUserId: args.userId,
    recordedByAgentId: args.agentId ?? null,
  };

  const updatedReview: ReviewResult & { decompositionOverride: DecompositionOverride } = {
    ...review!,
    decompositionOverride: override,
  };

  await db.$transaction(async (tx) => {
    await tx.featureBuild.update({
      where: { buildId: args.buildId },
      data: { designReview: updatedReview as never },
    });

    await tx.buildActivity.create({
      data: {
        buildId: args.buildId,
        tool: "recordDecompositionOverride",
        summary: `Operator override recorded: keeping monolithic. Rationale: ${rationale}`,
      },
    });

    if (build.originatingBacklogItemId) {
      await tx.backlogItemActivity.create({
        data: {
          backlogItemId: build.originatingBacklogItemId,
          kind: "plan_backlog_coverage",
          summary: "Plan coverage accepted as atomic with operator rationale.",
          payload: {
            decision: "atomic",
            rationale,
            sourceBuildId: args.buildId,
            mappedItemIds: [],
            deliverables: [],
            recordedAt: override.recordedAt,
          },
          recordedById: args.userId,
          recordedByAgentId: args.agentId ?? null,
        },
      });
    }
  });

  return { ok: true, override };
}
