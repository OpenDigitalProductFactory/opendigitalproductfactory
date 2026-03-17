"use server";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma, type Prisma } from "@dpf/db";
import {
  validateFeatureBrief,
  canTransitionPhase,
  checkPhaseGate,
  generateBuildId,
  bumpVersion,
  type FeatureBrief,
  type BuildPhase,
  type VersionBump,
} from "@/lib/feature-build-types";
import * as crypto from "crypto";

// ─── Auth Guard ──────────────────────────────────────────────────────────────

async function requireBuildAccess(): Promise<string> {
  const session = await auth();
  const user = session?.user;
  if (
    !user ||
    !can(
      { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
      "view_platform"
    )
  ) {
    throw new Error("Unauthorized");
  }
  return user.id!;
}

// ─── Create Feature Build ────────────────────────────────────────────────────

export async function createFeatureBuild(input: {
  title: string;
  description?: string;
  portfolioId?: string;
}): Promise<{ buildId: string }> {
  const userId = await requireBuildAccess();

  if (!input.title.trim()) throw new Error("Title is required");

  const buildId = generateBuildId();

  await prisma.featureBuild.create({
    data: {
      buildId,
      title: input.title.trim(),
      ...(input.description !== undefined && { description: input.description.trim() || null }),
      ...(input.portfolioId !== undefined && { portfolioId: input.portfolioId || null }),
      createdById: userId,
    },
  });

  return { buildId };
}

// ─── Update Feature Brief ────────────────────────────────────────────────────

export async function updateFeatureBrief(
  buildId: string,
  brief: FeatureBrief,
): Promise<void> {
  const userId = await requireBuildAccess();

  const build = await prisma.featureBuild.findUnique({ where: { buildId } });
  if (!build) throw new Error("Build not found");
  if (build.createdById !== userId) throw new Error("Forbidden");
  if (build.phase !== "ideate") throw new Error("Brief can only be updated during Ideate phase");

  const validation = validateFeatureBrief(brief);
  if (!validation.valid) throw new Error(validation.errors.join(", "));

  await prisma.featureBuild.update({
    where: { buildId },
    data: { brief: brief as unknown as Prisma.InputJsonValue },
  });
}

// ─── Advance Phase ───────────────────────────────────────────────────────────

export async function advanceBuildPhase(
  buildId: string,
  targetPhase: BuildPhase,
): Promise<void> {
  const userId = await requireBuildAccess();

  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: {
      id: true,
      phase: true,
      createdById: true,
      designDoc: true,
      designReview: true,
      buildPlan: true,
      planReview: true,
      taskResults: true,
      verificationOut: true,
      acceptanceMet: true,
    },
  });
  if (!build) throw new Error("Build not found");
  if (build.createdById !== userId) throw new Error("Forbidden");

  const currentPhase = build.phase as BuildPhase;
  if (!canTransitionPhase(currentPhase, targetPhase)) {
    throw new Error(`Cannot transition from ${currentPhase} to ${targetPhase}`);
  }

  const gate = checkPhaseGate(currentPhase, targetPhase, {
    designDoc: build.designDoc,
    designReview: build.designReview,
    buildPlan: build.buildPlan,
    planReview: build.planReview,
    taskResults: build.taskResults,
    verificationOut: build.verificationOut,
    acceptanceMet: build.acceptanceMet,
  });

  if (!gate.allowed) {
    throw new Error(gate.reason ?? "Phase gate check failed");
  }

  await prisma.featureBuild.update({
    where: { buildId },
    data: { phase: targetPhase },
  });
}

// ─── Update Sandbox Info ─────────────────────────────────────────────────────

export async function updateSandboxInfo(
  buildId: string,
  sandboxId: string,
  sandboxPort: number,
): Promise<void> {
  const userId = await requireBuildAccess();

  const build = await prisma.featureBuild.findUnique({ where: { buildId } });
  if (!build) throw new Error("Build not found");
  if (build.createdById !== userId) throw new Error("Forbidden");

  await prisma.featureBuild.update({
    where: { buildId },
    data: { sandboxId, sandboxPort },
  });
}

// ─── Save Build Results ──────────────────────────────────────────────────────

export async function saveBuildResults(
  buildId: string,
  results: { diffSummary: string; diffPatch: string; codingProvider: string },
): Promise<void> {
  const userId = await requireBuildAccess();

  const build = await prisma.featureBuild.findUnique({ where: { buildId } });
  if (!build) throw new Error("Build not found");
  if (build.createdById !== userId) throw new Error("Forbidden");

  await prisma.featureBuild.update({
    where: { buildId },
    data: {
      diffSummary: results.diffSummary,
      diffPatch: results.diffPatch,
      codingProvider: results.codingProvider,
    },
  });
}

// ─── Delete Feature Build ────────────────────────────────────────────────────

export async function deleteFeatureBuild(buildId: string): Promise<void> {
  const userId = await requireBuildAccess();

  const build = await prisma.featureBuild.findUnique({ where: { buildId } });
  if (!build) throw new Error("Build not found");
  if (build.createdById !== userId) throw new Error("Forbidden");

  await prisma.featureBuild.delete({ where: { buildId } });
}

// ─── Ship Build — Register as DigitalProduct ────────────────────────────────

export async function shipBuild(input: {
  buildId: string;
  name: string;
  portfolioSlug: string;
  versionBump?: VersionBump;
}): Promise<{ productId: string; productInternalId: string; portfolioInternalId: string | null; message: string }> {
  const userId = await requireBuildAccess();

  const build = await prisma.featureBuild.findUnique({ where: { buildId: input.buildId } });
  if (!build) throw new Error("Build not found");
  if (build.createdById !== userId) throw new Error("Forbidden");

  // Resolve portfolio + root taxonomy node for the product
  const portfolio = await prisma.portfolio.findUnique({
    where: { slug: input.portfolioSlug },
    select: { id: true, slug: true },
  });
  let taxonomyNodeId: string | null = null;
  if (portfolio) {
    const rootNode = await prisma.taxonomyNode.findFirst({
      where: { portfolioId: portfolio.id, parentId: null },
      select: { id: true },
    });
    taxonomyNodeId = rootNode?.id ?? null;
  }

  // Use a transaction for product create/update + build link
  const result = await prisma.$transaction(async (tx) => {
    let product: { id: string; productId: string; version: string };

    if (build.digitalProductId) {
      // Subsequent build — bump version on existing product
      const existing = await tx.digitalProduct.findUnique({
        where: { id: build.digitalProductId },
        select: { id: true, productId: true, version: true },
      });
      if (!existing) throw new Error("Linked product not found");

      const newVersion = bumpVersion(existing.version, input.versionBump ?? "minor");
      await tx.digitalProduct.update({
        where: { id: existing.id },
        data: {
          version: newVersion,
          lifecycleStage: "production",
          lifecycleStatus: "active",
          ...(portfolio ? { portfolioId: portfolio.id } : {}),
          ...(taxonomyNodeId ? { taxonomyNodeId } : {}),
        },
      });
      product = { ...existing, version: newVersion };
    } else {
      // First ship — create new product
      const productId = `DP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const created = await tx.digitalProduct.create({
        data: {
          productId,
          name: input.name,
          lifecycleStage: "production",
          lifecycleStatus: "active",
          version: "1.0.0",
          ...(portfolio ? { portfolioId: portfolio.id } : {}),
          ...(taxonomyNodeId ? { taxonomyNodeId } : {}),
        },
        select: { id: true, productId: true, version: true },
      });
      product = created;
    }

    // Link build to product (do NOT set phase "complete" yet — that happens after epic creation)
    await tx.featureBuild.update({
      where: { buildId: input.buildId },
      data: { digitalProductId: product.id },
    });

    return product;
  });

  // Git tagging + version tracking (best-effort — failures do not block shipping)
  let previousTag: string | null = null;
  let gitCommitHash: string | null = null;
  let changeCount = 0;

  try {
    const { createTag, isGitAvailable, getLatestTag, getCommitCount, getCurrentCommitHash } = await import("@/lib/git-utils");

    if (await isGitAvailable()) {
      // Capture previous tag BEFORE creating the new one
      previousTag = await getLatestTag();
      gitCommitHash = await getCurrentCommitHash();

      if (previousTag) {
        changeCount = await getCommitCount(previousTag);
      }

      // Create the new tag
      const tagName = `v${result.version}`;
      const tagMessage = `${input.name} v${result.version}\n\nBuild: ${input.buildId}\nShipped-By: ${userId}`;
      const tagResult = await createTag({ tag: tagName, message: tagMessage });
      if ("error" in tagResult) {
        console.warn("[shipBuild] git tag failed:", tagResult.error);
      }
    }
  } catch (err) {
    console.warn("[shipBuild] git tag error:", err);
  }

  // Create ProductVersion + ChangePromotion records (best-effort)
  try {
    const { createProductVersion } = await import("@/lib/version-tracking");

    await createProductVersion({
      digitalProductId: result.id,
      version: result.version,
      gitTag: `v${result.version}`,
      gitCommitHash: gitCommitHash ?? "unknown",
      featureBuildId: build.id,
      shippedBy: userId,
      changeCount,
      ...(build.diffSummary ? { changeSummary: build.diffSummary } : {}),
    });
  } catch (err) {
    console.warn("[shipBuild] version tracking failed:", err);
  }

  return {
    productId: result.productId,
    productInternalId: result.id,
    portfolioInternalId: portfolio?.id ?? null,
    message: `Registered ${input.name} as ${result.productId} v${result.version} in the ${input.portfolioSlug} portfolio.`,
  };
}

// ─── Complete Build — mark phase as complete after all ship steps ────────────

export async function completeBuild(buildId: string): Promise<void> {
  const userId = await requireBuildAccess();

  const build = await prisma.featureBuild.findUnique({ where: { buildId } });
  if (!build) throw new Error("Build not found");
  if (build.createdById !== userId) throw new Error("Forbidden");

  await prisma.featureBuild.update({
    where: { buildId },
    data: { phase: "complete" },
  });
}

// ─── Create Epic + Backlog Items for a Build ────────────────────────────────

export async function createBuildEpic(input: {
  buildId: string;
  title: string;
  portfolioSlug?: string;
  digitalProductId?: string;
}): Promise<{ epicId: string; message: string }> {
  await requireBuildAccess();

  // Resolve portfolio slug to internal ID
  let portfolioInternalId: string | null = null;
  if (input.portfolioSlug) {
    const portfolio = await prisma.portfolio.findUnique({
      where: { slug: input.portfolioSlug },
      select: { id: true },
    });
    portfolioInternalId = portfolio?.id ?? null;
  }

  const epicId = `EP-BUILD-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;

  // Wrap epic + backlog items in a transaction for consistency
  const epic = await prisma.$transaction(async (tx) => {
    const created = await tx.epic.create({
      data: {
        epicId,
        title: input.title,
        status: "open",
      },
      select: { id: true, epicId: true },
    });

    // Link epic to portfolio if resolved
    if (portfolioInternalId) {
      await tx.epicPortfolio.create({
        data: { epicId: created.id, portfolioId: portfolioInternalId },
      }).catch((e) => {
        console.warn("[createBuildEpic] portfolio link failed:", e);
      });
    }

    // Create "done" backlog item for the shipped work
    const doneItemId = `BI-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    await tx.backlogItem.create({
      data: {
        itemId: doneItemId,
        title: `Ship: ${input.title}`,
        type: "product",
        status: "done",
        body: `Feature shipped via Build Studio (${input.buildId}).`,
        epicId: created.id,
        ...(input.digitalProductId ? { digitalProductId: input.digitalProductId } : {}),
      },
    });

    // Seed initial feedback-gathering item
    const feedbackItemId = `BI-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    await tx.backlogItem.create({
      data: {
        itemId: feedbackItemId,
        title: `Gather user feedback on ${input.title.replace(/\sv[\d.]+$/, "")}`,
        type: "product",
        status: "open",
        body: "Collect initial user feedback and file follow-up items.",
        epicId: created.id,
        ...(input.digitalProductId ? { digitalProductId: input.digitalProductId } : {}),
      },
    });

    return created;
  });

  return {
    epicId: epic.epicId,
    message: `Created epic ${epic.epicId} with 2 backlog items (1 done, 1 open for feedback).`,
  };
}
