"use server";

import { requireCapability } from "@/lib/actions/shared/guards";
import { executeProductionRuntimeCapabilityTransition } from "@/lib/platform-runtime/runtime-capability-executor";

export type RuntimeCapabilityMutationInput = { transitionId: string; desiredKeys: string[] };

/** Authenticated, serializable-only mutation boundary. Actor identity is always
 * replaced by the verified session identity before the durable saga begins. */
export async function requestRuntimeCapabilityTransition(input: RuntimeCapabilityMutationInput) {
  const { userId } = await requireCapability("manage_platform");
  return executeProductionRuntimeCapabilityTransition({ ...input, requestedById: userId });
}
