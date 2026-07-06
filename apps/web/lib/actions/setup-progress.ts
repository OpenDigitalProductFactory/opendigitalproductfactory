"use server";

import { prisma } from "@dpf/db";
import { SETUP_STEPS, type SetupStep, type StepStatus, type SetupContext } from "./setup-constants";
import { runSetupCompletionSeeds } from "@/lib/onboarding/setup-completion-seeds";

/**
 * Runs once when initial setup completes: the shared seed chain in
 * setup-completion-seeds.ts (mission prompt, WWWD corpus, portfolio
 * decomposition BI-2D452667, market offer BI-4503E6B9, archetype supply,
 * risk posture + envelope). Fail-open and idempotent — onboarding completion
 * must never block on embedding/seeding errors, and the seeds are safe to
 * re-run. The boot backfill (backfill-org-wwwd-on-boot.ts) runs the same
 * chain for installs that completed setup before these seeders existed.
 */
async function finalizeSetupCompletion(organizationId: string | null): Promise<void> {
  try {
    const orgId =
      organizationId ??
      (await prisma.organization.findFirst({ select: { id: true } }))?.id ??
      null;
    if (!orgId) return;

    await runSetupCompletionSeeds(orgId);
  } catch (err) {
    console.warn("[setup] mission/WWWD seeding on completion failed (fail-open):", err);
  }
}

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

  const steps = progress.steps as Record<string, StepStatus>;
  const context = { ...(progress.context as SetupContext), ...contextUpdate };
  const currentIdx = SETUP_STEPS.indexOf(progress.currentStep as SetupStep);

  // The storefront step is only "complete" once the storefront actually exists.
  // The setup overlay's Continue must not advance past it (to operating-hours /
  // platform-development / ...) while StorefrontConfig is still null — otherwise
  // the operator finishes onboarding with no portal (R1-CS-A-003). Completing the
  // embedded SetupWizard creates the config; until then, Continue is a no-op that
  // keeps the user on the storefront setup.
  if (progress.currentStep === "storefront") {
    const storefront = await prisma.storefrontConfig.findFirst({ select: { id: true } });
    if (!storefront) {
      return { ...progress, blocked: "storefront-required" as const };
    }
  }

  steps[progress.currentStep] = "completed";

  const nextIdx = currentIdx + 1;
  const nextStep = nextIdx < SETUP_STEPS.length ? SETUP_STEPS[nextIdx] : null;

  const updated = await prisma.platformSetupProgress.update({
    where: { id: progressId },
    data: {
      currentStep: nextStep ?? progress.currentStep,
      steps,
      context,
      ...(nextStep === null ? { completedAt: new Date() } : {}),
    },
  });

  if (nextStep === null) await finalizeSetupCompletion(progress.organizationId);
  return updated;
}

/** Mark current step skipped and advance. */
export async function skipStep(progressId: string) {
  const progress = await prisma.platformSetupProgress.findUniqueOrThrow({
    where: { id: progressId },
  });

  const steps = progress.steps as Record<string, StepStatus>;
  const context = progress.context as SetupContext;
  const currentIdx = SETUP_STEPS.indexOf(progress.currentStep as SetupStep);

  steps[progress.currentStep] = "skipped";
  context.skippedSteps = [
    ...(context.skippedSteps ?? []),
    progress.currentStep,
  ];

  const nextIdx = currentIdx + 1;
  const nextStep = nextIdx < SETUP_STEPS.length ? SETUP_STEPS[nextIdx] : null;

  const updated = await prisma.platformSetupProgress.update({
    where: { id: progressId },
    data: {
      currentStep: nextStep ?? progress.currentStep,
      steps,
      context,
      ...(nextStep === null ? { completedAt: new Date() } : {}),
    },
  });

  if (nextStep === null) await finalizeSetupCompletion(progress.organizationId);
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
  return (progress.context as SetupContext) ?? null;
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
