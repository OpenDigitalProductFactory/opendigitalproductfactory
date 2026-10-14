"use server";

import { requireCapability } from "@/lib/actions/shared/guards";
import { rotateProductionRuntimeTransitionSecret } from "@/lib/platform-runtime/runtime-capability-executor";
import { previewRuntimeCapabilityReconciliationForActor, requestRuntimeCapabilityTransitionForActor, type RuntimeCapabilityMutationInput as RuntimeCommandInput } from "@/lib/platform-runtime/runtime-capability-commands";
import { assertRuntimeCapabilityTransitionAdmission } from "@/lib/platform-runtime/transition-recovery";
import { buildMonitoringReconciliationIntent } from "@/lib/platform-runtime/monitoring-reconciliation-intent";
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

/** A machine-readable failure code is safe to show; anything else (paths,
 * stack-ish text) is logged server-side and replaced with `fallback`. */
function failureCode(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : "";
  return /^[a-z][a-z0-9_:-]{2,120}$/.test(message) ? message : fallback;
}

/**
 * BI-F0C2E8F5: Settings → Monitoring. Turns monitoring on or off as a
 * reconciliation-mode transition built from the observed host and database
 * baselines, touching only runtime:deep-observability, so drifted capability
 * records no longer make the host refuse the change as stale.
 *
 * Every refusal after authentication is RETURNED as `{ status: "failed",
 * failure }` rather than thrown: Next replaces a thrown server-action message
 * with a generic digest in production, so the operator would see no reason.
 */
export async function requestMonitoringChange(input: { transitionId: string; turnOn: boolean }) {
  const { transitionId, turnOn } = structuredClone(input);
  const { userId } = await requireCapability("manage_platform");
  if (typeof transitionId !== "string" || typeof turnOn !== "boolean") return { status: "failed" as const, failure: "invalid_monitoring_request" };

  let request: ReturnType<typeof buildMonitoringReconciliationIntent>;
  try {
    request = buildMonitoringReconciliationIntent(await previewRuntimeCapabilityReconciliationForActor(userId), turnOn);
  } catch (error) {
    console.error("[monitoring-settings] reconciliation preview failed", { event: "monitoring_reconciliation_preview_failed", transitionId, error: error instanceof Error ? error.message : String(error) });
    return { status: "failed" as const, failure: error instanceof Error && error.message === "monitoring_has_dependents" ? "monitoring_has_dependents" : "runtime_reconciliation_protocol_unavailable" };
  }
  try {
    return await requestRuntimeCapabilityTransitionForActor({ transitionId, desiredKeys: request.desiredKeys, mode: "reconciliation", reconciliation: request.reconciliation }, userId);
  } catch (error) {
    console.error("[monitoring-settings] change request failed", { event: "monitoring_change_request_failed", transitionId, error: error instanceof Error ? error.message : String(error) });
    return { status: "failed" as const, failure: failureCode(error, "runtime_transition_request_failed") };
  }
}

/** Signing-key rotation is DB-aware and uses the same host reconciliation
 * boundary as transition admission; direct host rotation is install-only. */
export async function rotateRuntimeTransitionSecret() {
  await requireCapability("manage_platform");
  await assertRuntimeCapabilityTransitionAdmission();
  return rotateProductionRuntimeTransitionSecret();
}
