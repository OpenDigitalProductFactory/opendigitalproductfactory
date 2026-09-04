"use server";

import { prisma } from "@dpf/db";
import { resolveCloudProviderReadiness } from "@/lib/inference/cloud-provider-readiness";
import { SETUP_STEPS, type StepStatus, type SetupContext } from "./setup-constants";
import {
  projectSetupStepCompletion,
  projectSetupStepResolution,
} from "@/lib/onboarding/setup-progress-projection";
import { finalizeSetupCompletion } from "@/lib/onboarding/setup-progress-service.server";

const BOOTSTRAP_PLATFORM_ORG = {
  orgId: "ORG-PLATFORM",
  slug: "platform",
} as const;

/** Check if this is a first-run scenario (no org + no completed setup). */
export async function isFirstRun(): Promise<boolean> {
  const [orgCount, bootstrapOrg] = await Promise.all([
    prisma.organization.count(),
    prisma.organization.findFirst({
      where: {
        ...BOOTSTRAP_PLATFORM_ORG,
        storefrontConfig: { is: null },
        businessContext: { is: null },
        platformSetupProgress: { is: null },
        brandingConfig: { is: null },
      },
      select: { id: true },
    }),
  ]);

  const effectiveOrgCount = bootstrapOrg ? Math.max(orgCount - 1, 0) : orgCount;
  if (effectiveOrgCount > 0) return false;

  const completedSetup = await prisma.platformSetupProgress.findFirst({
    where: { completedAt: { not: null } },
  });
  return completedSetup === null;
}

/** Get the current (or most recent) setup progress record. */
export async function getSetupProgress() {
  return prisma.platformSetupProgress.findFirst({
    where: { completedAt: null },
    orderBy: { createdAt: "desc" },
  });
}

/** Create a new setup progress record with all steps pending. */
export async function createSetupProgress() {
  const steps: Record<string, StepStatus> = {};
  for (const step of SETUP_STEPS) {
    steps[step] = "pending";
  }

  return prisma.platformSetupProgress.create({
    data: {
      currentStep: SETUP_STEPS[0],
      steps,
      context: {},
    },
  });
}

/** Mark current step completed and advance to the next. */
export async function advanceStep(
  progressId: string,
  contextUpdate?: Partial<SetupContext>,
) {
  const progress = await prisma.platformSetupProgress.findUniqueOrThrow({
    where: { id: progressId },
  });

  const context = { ...(progress.context as SetupContext), ...contextUpdate };

  // The storefront step is only "complete" once the storefront actually exists.
  // The setup overlay's Continue must not advance past it (to operating-hours /
  // platform-development / ...) while StorefrontConfig is still null — otherwise
  // the operator finishes onboarding with no portal (R1-CS-A-003). Completing the
  // embedded SetupWizard creates the config; until then, Continue is a no-op that
  // keeps the user on the storefront setup.
  if (progress.currentStep === "storefront") {
    const storefront = await prisma.storefrontConfig.findFirst({
      where: progress.organizationId ? { organizationId: progress.organizationId } : undefined,
      select: { id: true },
    });
    if (!storefront) {
      return { ...progress, blocked: "storefront-required" as const };
    }
  }

  const projection = projectSetupStepCompletion({
    completedStep: progress.currentStep as (typeof SETUP_STEPS)[number],
    steps: progress.steps as Record<string, StepStatus>,
  });

  const updated = await prisma.platformSetupProgress.update({
    where: { id: progressId },
    data: {
      currentStep: projection.currentStep,
      steps: projection.steps,
      context,
      ...(projection.isComplete ? { completedAt: new Date() } : {}),
    },
  });

  if (projection.isComplete) await finalizeSetupCompletion(progress.organizationId);
  return updated;
}

/** Mark current step skipped and advance. */
export async function skipStep(progressId: string) {
  const progress = await prisma.platformSetupProgress.findUniqueOrThrow({
    where: { id: progressId },
  });

  const context = progress.context as SetupContext;
  const projection = projectSetupStepResolution({
    resolvedStep: progress.currentStep as (typeof SETUP_STEPS)[number],
    resolution: "skipped",
    steps: progress.steps as Record<string, StepStatus>,
  });
  const updatedContext = {
    ...context,
    skippedSteps: [
      ...(context.skippedSteps ?? []),
      progress.currentStep,
    ],
  };

  const updated = await prisma.platformSetupProgress.update({
    where: { id: progressId },
    data: {
      currentStep: projection.currentStep,
      steps: projection.steps,
      context: updatedContext,
      ...(projection.isComplete ? { completedAt: new Date() } : {}),
    },
  });

  if (projection.isComplete) await finalizeSetupCompletion(progress.organizationId);
  return updated;
}

/** Record that the COO auto-message trigger has fired for this step.
 * Used by SetupOverlay to avoid re-firing the welcome on page reloads. */
export async function markStepTriggered(progressId: string, step: string) {
  const progress = await prisma.platformSetupProgress.findUniqueOrThrow({
    where: { id: progressId },
    select: { context: true },
  });
  const context = (progress.context ?? {}) as SetupContext;
  const triggered = context.triggeredSteps ?? [];
  if (triggered.includes(step)) return;

  await prisma.platformSetupProgress.update({
    where: { id: progressId },
    data: {
      context: { ...context, triggeredSteps: [...triggered, step] },
    },
  });
}

/** Pause the setup for later resumption. */
export async function pauseSetup(progressId: string) {
  return prisma.platformSetupProgress.update({
    where: { id: progressId },
    data: { pausedAt: new Date() },
  });
}

/** Mark setup as complete. */
export async function completeSetup(progressId: string) {
  const updated = await prisma.platformSetupProgress.update({
    where: { id: progressId },
    data: { completedAt: new Date() },
    select: { id: true, organizationId: true, completedAt: true },
  });
  await finalizeSetupCompletion(updated.organizationId);
  return updated;
}

/** Link setup progress to a user after account creation (Step 2). */
export async function linkSetupToUser(progressId: string, userId: string) {
  return prisma.platformSetupProgress.update({
    where: { id: progressId },
    data: { userId },
  });
}

/** Link setup progress to an organization after org creation (Step 1). */
export async function linkSetupToOrg(progressId: string, orgId: string) {
  return prisma.platformSetupProgress.update({
    where: { id: progressId },
    data: { organizationId: orgId },
  });
}

/** Read the setup context from the active (incomplete) setup record. Returns null if no active setup. */
export async function getSetupContext(): Promise<SetupContext | null> {
  const progress = await prisma.platformSetupProgress.findFirst({
    where: { completedAt: null },
    orderBy: { createdAt: "desc" },
    select: { context: true },
  });
  if (!progress) return null;
  const stored = (progress.context as SetupContext) ?? null;
  if (!stored) return null;
  // BI-575F0046 Slice 2: computed live, never stored. A stored answer goes stale
  // the moment the owner connects a provider or completes its trust review, and
  // the guidance built from it would then be confidently wrong.
  const cloudProviderReadiness = await resolveSetupCloudReadiness();
  return cloudProviderReadiness ? { ...stored, cloudProviderReadiness } : stored;
}

/** Live readiness for setup guidance — see SetupContext.cloudProviderReadiness. */
async function resolveSetupCloudReadiness(): Promise<"none" | "public-only" | "ready" | undefined> {
  try {
    const providers = await prisma.modelProvider.findMany({
      where: { status: "active" },
      select: { providerId: true, name: true, status: true, sensitivityClearance: true },
    });
    return resolveCloudProviderReadiness(providers).state;
  } catch {
    // Setup guidance must not break because provider state could not be read.
    // Undefined renders as "not known yet", which is honest; guessing "ready"
    // or "none" would put a confident wrong sentence in the COO's mouth.
    return undefined;
  }
}

/** Merge a partial context update into the active (incomplete) setup record. No-op if no active setup. */
export async function updateSetupContext(patch: Partial<SetupContext>): Promise<void> {
  const progress = await prisma.platformSetupProgress.findFirst({
    where: { completedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, context: true },
  });
  if (!progress) return;

  const merged = { ...(progress.context as SetupContext), ...patch };
  await prisma.platformSetupProgress.update({
    where: { id: progress.id },
    data: { context: merged },
  });
}
