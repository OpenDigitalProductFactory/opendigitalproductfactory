import "server-only";

import { executeProductionRuntimeCapabilityTransition, readProductionRuntimeCapabilityReconciliationPreview } from "./runtime-capability-executor";
import { assertRuntimeCapabilityTransitionAdmission } from "./transition-recovery";
import type { RuntimeReconciliationIntent } from "./transition-protocol";

export type RuntimeCapabilityMutationInput = { transitionId: string; desiredKeys: string[]; mode?: "transition" | "reconciliation"; reconciliation?: RuntimeReconciliationIntent };

function assertActorPresent(userId: string) {
  if (typeof userId !== "string" || !userId.trim()) throw new Error("Unauthorized");
}

/** Internal command: the browser or governed MCP edge must first authorize
 * manage_platform. MCP supplies its verified user, never a browser cookie or
 * an actor claimed by the request body. */
export async function previewRuntimeCapabilityReconciliationForActor(userId: string) {
  assertActorPresent(userId);
  return readProductionRuntimeCapabilityReconciliationPreview();
}

export async function requestRuntimeCapabilityTransitionForActor(input: RuntimeCapabilityMutationInput, userId: string) {
  assertActorPresent(userId);
  input = structuredClone(input);
  await assertRuntimeCapabilityTransitionAdmission();
  return executeProductionRuntimeCapabilityTransition({ ...input, requestedById: userId });
}
