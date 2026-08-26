import { agentEventBus } from "@/lib/agent-event-bus";
import {
  discoverModelsInternal,
  profileModelsInternal,
} from "@/lib/inference/ai-provider-internals";
import {
  installLocalModel,
  type LocalModelPullProgress,
} from "@/lib/inference/local-model-management";
import {
  updateLocalModelOperation,
  type LocalModelOperationUpdate,
} from "@/lib/inference/local-model-operations";
import { inngest } from "../inngest-client";
import { gateBetweenSteps } from "../quiescence-gates";

export type LocalModelInstallInput = {
  jobId: string;
  attempt: number;
  modelReference: string;
  requestedByUserId: string;
};

export type LocalModelInstallDependencies = {
  update(input: LocalModelOperationUpdate): Promise<unknown>;
  install(
    reference: string,
    onProgress: (progress: LocalModelPullProgress) => void | Promise<void>,
  ): Promise<void>;
  discover(providerId: string): Promise<{ discovered: number; newCount: number; error?: string }>;
  profile(providerId: string): Promise<{ profiled: number; failed: number; error?: string }>;
  emit(event: {
    type: "system:local-model";
    operationId: string;
    modelReference: string;
    status: "running" | "completed" | "failed";
    observedAt: string;
  }): void;
};

const defaultDependencies: LocalModelInstallDependencies = {
  update: updateLocalModelOperation,
  install: installLocalModel,
  discover: discoverModelsInternal,
  profile: profileModelsInternal,
  emit: (event) => agentEventBus.broadcastSystem(event),
};

export async function runLocalModelInstall(
  input: LocalModelInstallInput,
  dependencies: LocalModelInstallDependencies = defaultDependencies,
): Promise<{ status: "completed" }> {
  const base = { jobId: input.jobId, attempt: input.attempt };
  const emit = (status: "running" | "completed" | "failed") => dependencies.emit({
    type: "system:local-model",
    operationId: input.jobId,
    modelReference: input.modelReference,
    status,
    observedAt: new Date().toISOString(),
  });

  await dependencies.update({
    ...base,
    status: "running",
    message: "Starting download",
    error: null,
  });
  emit("running");

  let installed = false;
  try {
    let lastPercent: number | null = null;
    await dependencies.install(input.modelReference, async (progress) => {
      if (progress.percent !== null && progress.percent === lastPercent) return;
      lastPercent = progress.percent;
      await dependencies.update({
        ...base,
        status: "running",
        transferredBytes: progress.transferredBytes,
        totalBytes: progress.totalBytes,
        percent: progress.percent,
        message: progress.message ?? "Downloading",
        error: null,
      });
      emit("running");
    });
    installed = true;

    const discovery = await dependencies.discover("local");
    if (discovery.error && discovery.discovered === 0) {
      throw new Error("The model installed, but routing refresh failed.");
    }
    const profiling = await dependencies.profile("local");
    if (profiling.error && profiling.profiled === 0) {
      throw new Error("The model installed, but routing refresh failed.");
    }

    await dependencies.update({
      ...base,
      status: "completed",
      percent: 100,
      message: "Installed and ready",
      error: null,
    });
    emit("completed");
    return { status: "completed" };
  } catch (error) {
    await dependencies.update({
      ...base,
      status: "failed",
      message: installed ? "Installed; routing refresh failed" : "Install failed",
      error: installed
        ? "The model installed, but routing refresh needs attention."
        : "The local runtime could not install that model.",
    });
    emit("failed");
    throw error;
  }
}

export const localModelInstall = inngest.createFunction(
  {
    id: "inference/local-model-install",
    retries: 2,
    concurrency: { limit: 1, scope: "fn" },
    triggers: [{ event: "inference/local-model.install" }],
  },
  async ({ event, step }) => {
    await gateBetweenSteps(step, "before-local-model-install");
    const input = parseInstallInput(event.data);
    return step.run("install-local-model", () => runLocalModelInstall(input));
  },
);

function parseInstallInput(value: Record<string, unknown>): LocalModelInstallInput {
  if (
    typeof value.jobId !== "string" ||
    typeof value.attempt !== "number" ||
    !Number.isInteger(value.attempt) ||
    value.attempt < 1 ||
    typeof value.modelReference !== "string" ||
    typeof value.requestedByUserId !== "string"
  ) {
    throw new Error("Invalid local model install event.");
  }
  return {
    jobId: value.jobId,
    attempt: value.attempt,
    modelReference: value.modelReference,
    requestedByUserId: value.requestedByUserId,
  };
}
