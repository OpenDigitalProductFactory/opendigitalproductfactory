"use server";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma, type Prisma } from "@dpf/db";
import {
  validateFeatureBrief,
  canTransitionPhase,
  generateBuildId,
  type FeatureBrief,
  type BuildPhase,
} from "@/lib/feature-build-types";

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

  const build = await prisma.featureBuild.findUnique({ where: { buildId } });
  if (!build) throw new Error("Build not found");
  if (build.createdById !== userId) throw new Error("Forbidden");

  const currentPhase = build.phase as BuildPhase;
  if (!canTransitionPhase(currentPhase, targetPhase)) {
    throw new Error(`Cannot transition from ${currentPhase} to ${targetPhase}`);
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
