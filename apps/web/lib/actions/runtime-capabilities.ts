"use server";

import { requireCapability } from "@/lib/actions/shared/guards";
import { rotateProductionRuntimeTransitionSecret } from "@/lib/platform-runtime/runtime-capability-executor";
import { previewRuntimeCapabilityReconciliationForActor, requestRuntimeCapabilityTransitionForActor, type RuntimeCapabilityMutationInput as RuntimeCommandInput } from "@/lib/platform-runtime/runtime-capability-commands";
import { assertRuntimeCapabilityTransitionAdmission } from "@/lib/platform-runtime/transition-recovery";
export type RuntimeCapabilityMutationInput = RuntimeCommandInput;

export async function previewRuntimeCapabilityReconciliation() {
  const { userId } = await requireCapability("manage_platform");
  return previewRuntimeCapabilityReconciliationForActor(userId);
}

/** Authenticated, serializable-only mutation boundary. Actor identity is always
 * replaced by the verified session identity before the durable saga begins. */
export async function requestRuntimeCapabilityTransition(input: RuntimeCapabilityMutationInput) {
  input = structuredClone(input);
  const { userId } = await requireCapability("manage_platform");
  return requestRuntimeCapabilityTransitionForActor(input, userId);
}

/** Signing-key rotation is DB-aware and uses the same host reconciliation
 * boundary as transition admission; direct host rotation is install-only. */
export async function rotateRuntimeTransitionSecret() {
  await requireCapability("manage_platform");
  await assertRuntimeCapabilityTransitionAdmission();
  return rotateProductionRuntimeTransitionSecret();
}
