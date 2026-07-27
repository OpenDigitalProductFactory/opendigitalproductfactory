import type { InferenceDataScreenReceipt } from "@/lib/inference/data-screening/types";
import { isLocalProviderId } from "./provider-locality";
import type { SensitivityLevel } from "./types";

type GuardedDecision = {
  sensitivity: SensitivityLevel;
  policyRulesApplied: string[];
  inferenceDataScreenReceipt?: InferenceDataScreenReceipt;
};

type GuardedCandidate = {
  endpointId: string;
  providerId: string;
  excluded: boolean;
  excludedReason?: string;
};

export class UnsafeInferenceDispatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeInferenceDispatchError";
  }
}

export function requiresInferenceDispatchScreen(decision: GuardedDecision): boolean {
  return (
    decision.inferenceDataScreenReceipt !== undefined ||
    decision.policyRulesApplied.includes("inference-dispatch") ||
    decision.sensitivity === "confidential" ||
    decision.sensitivity === "restricted"
  );
}

export function assertInferenceDispatchScreen(decision: GuardedDecision): void {
  if (!requiresInferenceDispatchScreen(decision)) {
    return;
  }

  const receipt = decision.inferenceDataScreenReceipt;
  if (!receipt || receipt.schemaVersion !== "inference-data-screen/v1" || receipt.rawPayloadStored !== false) {
    throw new UnsafeInferenceDispatchError(
      "Unsafe inference dispatch: missing inference data screen receipt.",
    );
  }

  if (receipt.routeEffect === "block") {
    throw new UnsafeInferenceDispatchError(
      `Unsafe inference dispatch: blocked by inference data screen ${receipt.screenId}.`,
    );
  }
}

export function isEligibleForScreenedDispatch(
  decision: GuardedDecision,
  candidate: GuardedCandidate | undefined,
): boolean {
  if (!candidate) {
    return false;
  }
  if (!requiresInferenceDispatchScreen(decision)) {
    return true;
  }

  const receipt = decision.inferenceDataScreenReceipt;
  if (
    !receipt ||
    receipt.schemaVersion !== "inference-data-screen/v1" ||
    receipt.rawPayloadStored !== false ||
    receipt.routeEffect === "block" ||
    candidate.excluded
  ) {
    return false;
  }

  return receipt.routeEffect !== "local-only" || isLocalProviderId(candidate.providerId);
}
