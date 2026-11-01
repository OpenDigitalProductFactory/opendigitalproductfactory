"use server";
import { prisma } from "@dpf/db";
import { requireCapability } from "@/lib/actions/shared/guards";
import { createSetupProgress, getSetupProgress, isFirstRun } from "./setup-progress";
import type { StepStatus } from "./setup-constants";
import { projectSetupStepCompletion } from "@/lib/onboarding/setup-progress-projection";
import { loadMonitoringCapabilityDecision } from "@/lib/platform-runtime/monitoring-switch-loader";
import { finalizeSetupCompletion } from "@/lib/onboarding/setup-progress-service.server";
import { err, ok } from "@/lib/shared/action-result";

export async function getProviderAccountSetupState() {
  const [progress, firstRun] = await Promise.all([getSetupProgress(), isFirstRun()]);
  const status = (progress?.steps as Record<string, StepStatus> | undefined)?.["ai-providers"];
  return { showCatalog: status === "completed" || status === "skipped" ? false : Boolean(progress || firstRun) };
}

/** Finish only provider selection; Local's operator pause and other setup steps retain their owners. */
export async function completeProviderAccountSetup() {
  await requireCapability("manage_provider_connections");
  let progress = await getSetupProgress();
  if (!progress) {
    if (!await isFirstRun()) return ok();
    progress = await createSetupProgress();
  }
  const steps = progress.steps as Record<string, StepStatus>;
  if (["completed", "skipped"].includes(steps["ai-providers"])) return ok();
  const projection = projectSetupStepCompletion({
    completedStep: "ai-providers",
    steps,
    monitoringDecision: await loadMonitoringCapabilityDecision(),
  });
  const updated = await prisma.platformSetupProgress.updateMany({
    where: { id: progress.id, updatedAt: progress.updatedAt, completedAt: null },
    data: { currentStep: projection.currentStep, steps: projection.steps, ...(projection.isComplete ? { completedAt: new Date() } : {}) },
  });
  if (!updated.count) return err("Setup changed. Refresh and retry.");
  if (projection.isComplete) await finalizeSetupCompletion(progress.organizationId);
  return ok();
}
