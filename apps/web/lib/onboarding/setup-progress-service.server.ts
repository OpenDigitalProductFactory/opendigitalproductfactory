import "server-only";

import { prisma } from "@dpf/db";
import type { SetupStep, StepStatus } from "@/lib/actions/setup-constants";
import { projectSetupStepCompletion } from "./setup-progress-projection";
import { runSetupCompletionSeeds } from "./setup-completion-seeds";

/**
 * Runs once when initial setup completes: the shared seed chain in
 * setup-completion-seeds.ts (mission prompt, WWWD corpus, portfolio
 * decomposition BI-2D452667, market offer BI-4503E6B9, archetype supply,
 * risk posture + envelope). Fail-open and idempotent — onboarding completion
 * must never block on embedding/seeding errors, and the seeds are safe to
 * re-run. The boot backfill runs the same chain for older completed installs.
 */
export async function finalizeSetupCompletion(
  organizationId: string | null,
): Promise<void> {
  try {
    const orgId =
      organizationId ??
      (await prisma.organization.findFirst({ select: { id: true } }))?.id ??
      null;
    if (!orgId) return;

    await runSetupCompletionSeeds(orgId);
  } catch (error) {
    console.warn("[setup] mission/WWWD seeding on completion failed (fail-open):", error);
  }
}

/**
 * Reconcile canonical domain evidence into the resumable setup projection.
 * The transition is scoped, monotonic, idempotent, and safe when work arrives
 * out of order; it never reopens a completed setup record.
 */
export async function completeSetupStepFromEvidence(
  organizationId: string,
  completedStep: SetupStep,
) {
  const progress = await prisma.platformSetupProgress.findFirst({
    where: { organizationId, completedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!progress) return null;

  const projection = projectSetupStepCompletion({
    completedStep,
    steps: progress.steps as Record<string, StepStatus>,
  });
  const alreadyProjected =
    progress.currentStep === projection.currentStep &&
    (progress.steps as Record<string, StepStatus>)[completedStep] === "completed";
  if (alreadyProjected) return progress;

  const updated = await prisma.platformSetupProgress.update({
    where: { id: progress.id },
    data: {
      currentStep: projection.currentStep,
      steps: projection.steps,
      ...(projection.isComplete ? { completedAt: new Date() } : {}),
    },
  });

  if (projection.isComplete) await finalizeSetupCompletion(organizationId);
  return updated;
}
