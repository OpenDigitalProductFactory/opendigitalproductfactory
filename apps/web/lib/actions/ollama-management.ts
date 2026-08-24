"use server";

import { requireCapability } from "@/lib/actions/shared/guards";
import {
  listLocalModels,
  removeLocalModel,
  type LocalModelInfo,
} from "@/lib/inference/local-model-management";
import {
  admitLocalModelInstall,
  reconcileRemovedLocalModel,
  updateLocalModelOperation,
} from "@/lib/inference/local-model-operations";
import { enqueueLocalModelInstall } from "@/lib/queue/local-model-install-events";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";

const REQUIRED_CAPABILITY = "manage_provider_connections" as const;

export async function listOllamaModels(): Promise<ActionResult<LocalModelInfo[]>> {
  try {
    await requireCapability(REQUIRED_CAPABILITY);
    return ok(await listLocalModels());
  } catch {
    return err("The installed model list is unavailable.");
  }
}

export type OllamaRunningModel = {
  name: string;
  sizeVram: number;
  sizeVramGb: string;
};

// Docker Model Runner doesn't expose running model / VRAM info
export async function getOllamaRunningModels(): Promise<{ models: OllamaRunningModel[]; error?: string }> {
  return { models: [] };
}

export async function pullOllamaModel(
  modelReference: string,
): Promise<ActionResult<{ operationId: string; status: "queued" | "running" }>> {
  let userId: string;
  try {
    ({ userId } = await requireCapability(REQUIRED_CAPABILITY));
  } catch {
    return err("You do not have permission to install local models.");
  }

  let admission: Awaited<ReturnType<typeof admitLocalModelInstall>>;
  try {
    admission = await admitLocalModelInstall(modelReference, userId);
  } catch {
    return err("That model reference cannot be installed.");
  }
  if (!admission.admitted) {
    return ok({
      operationId: admission.operation.jobId,
      status: admission.operation.status === "queued" ? "queued" : "running",
    });
  }

  try {
    await enqueueLocalModelInstall(
      {
        jobId: admission.operation.jobId,
        attempt: admission.operation.attempt,
        modelReference,
        requestedByUserId: userId,
      },
      admission.eventId,
    );
    return ok({ operationId: admission.operation.jobId, status: "queued" });
  } catch {
    await updateLocalModelOperation({
      jobId: admission.operation.jobId,
      attempt: admission.operation.attempt,
      status: "failed",
      error: "Background dispatch failed",
      message: "Install could not start",
    }).catch(() => null);
    return err("The model install could not be started. Try again.");
  }
}

export async function deleteOllamaModel(
  modelReference: string,
): Promise<ActionResult<{ alreadyAbsent: boolean; reconciliationWarning?: string }>> {
  try {
    await requireCapability(REQUIRED_CAPABILITY);
  } catch {
    return err("You do not have permission to remove local models.");
  }

  let removed: { alreadyAbsent: boolean };
  try {
    removed = await removeLocalModel(modelReference);
  } catch {
    return err("The local runtime could not remove that model.");
  }

  try {
    await reconcileRemovedLocalModel(modelReference);
    return ok(removed);
  } catch {
    return ok({
      ...removed,
      reconciliationWarning: "The model was removed, but routing is still refreshing.",
    });
  }
}
