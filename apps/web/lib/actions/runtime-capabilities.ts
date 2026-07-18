"use server";

import { requireCapability } from "@/lib/actions/shared/guards";
import { executeProductionRuntimeCapabilityTransition, rotateProductionRuntimeTransitionSecret } from "@/lib/platform-runtime/runtime-capability-executor";
import { assertRuntimeCapabilityTransitionAdmission } from "@/lib/platform-runtime/transition-recovery";

export type RuntimeCapabilityMutationInput = { transitionId: string; desiredKeys: string[] };

/** Authenticated, serializable-only mutation boundary. Actor identity is always
 * replaced by the verified session identity before the durable saga begins. */
export async function requestRuntimeCapabilityTransition(input: RuntimeCapabilityMutationInput) {
  const { userId } = await requireCapability("manage_platform");
  await assertRuntimeCapabilityTransitionAdmission();
  return executeProductionRuntimeCapabilityTransition({ ...input, requestedById: userId });
}

/** Signing-key rotation is DB-aware and uses the same host reconciliation
 * boundary as transition admission; direct host rotation is install-only. */
export async function rotateRuntimeTransitionSecret() {
  await requireCapability("manage_platform");
  await assertRuntimeCapabilityTransitionAdmission();
  return rotateProductionRuntimeTransitionSecret();
}
