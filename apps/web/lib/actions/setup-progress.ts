"use server";

import { prisma } from "@dpf/db";

export const SETUP_STEPS = [
  "business-identity",
  "owner-account",
  "ai-capabilities",
  "branding",
  "financial-basics",
  "first-workspace",
  "extensibility-preview",
  "whats-next",
] as const;

export type SetupStep = (typeof SETUP_STEPS)[number];
export type StepStatus = "pending" | "completed" | "skipped";

export type SetupContext = {
  orgName?: string;
  industry?: string;
  hasCloudProvider?: boolean;
  skippedSteps?: string[];
};

/** Check if this is a first-run scenario (no org + no completed setup). */
export async function isFirstRun(): Promise<boolean> {
  const orgCount = await prisma.organization.count();
  if (orgCount > 0) return false;

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

  steps[progress.currentStep] = "completed";

  const nextIdx = currentIdx + 1;
  const nextStep = nextIdx < SETUP_STEPS.length ? SETUP_STEPS[nextIdx] : null;

  return prisma.platformSetupProgress.update({
    where: { id: progressId },
    data: {
      currentStep: nextStep ?? progress.currentStep,
      steps,
      context,
      ...(nextStep === null ? { completedAt: new Date() } : {}),
    },
  });
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

  return prisma.platformSetupProgress.update({
    where: { id: progressId },
    data: {
      currentStep: nextStep ?? progress.currentStep,
      steps,
      context,
      ...(nextStep === null ? { completedAt: new Date() } : {}),
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
  return prisma.platformSetupProgress.update({
    where: { id: progressId },
    data: { completedAt: new Date() },
  });
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
