import type { InferenceDataScreenReceipt } from "@/lib/inference/data-screening/types";
import { isDecisionVersionSnapshotStillFresh } from "@/lib/govern/data/policy-enforcement";
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

export function assertInferenceDispatchScreen(
  decision: GuardedDecision,
  currentReceipt?: InferenceDataScreenReceipt,
): void {
  const currentScreenRequiresGuard = Boolean(
    currentReceipt &&
    (
      currentReceipt.classifiedDataClasses.length > 0 ||
      currentReceipt.policyEffect !== "allow" ||
      currentReceipt.routeEffect !== "allow"
    ),
  );
  if (!requiresInferenceDispatchScreen(decision) && !currentScreenRequiresGuard) {
    return;
  }

  const receipt = decision.inferenceDataScreenReceipt;
  if (!receipt || receipt.schemaVersion !== "inference-data-screen/v1" || receipt.rawPayloadStored !== false) {
    throw new UnsafeInferenceDispatchError(
      "Unsafe inference dispatch: missing inference data screen receipt.",
    );
  }

  if (
    !Array.isArray(receipt.decisionVersions) ||
    (
      receipt.decisionIds.length > 0 &&
      (
        receipt.decisionVersions.length !== receipt.decisionIds.length ||
        receipt.decisionVersions.some(
          (version) => !receipt.decisionIds.includes(version.decisionId),
        )
      )
    )
  ) {
    throw new UnsafeInferenceDispatchError(
      "Unsafe inference dispatch: missing policy decision version evidence.",
    );
  }

  if (receipt.routeEffect === "block") {
    throw new UnsafeInferenceDispatchError(
      `Unsafe inference dispatch: blocked by inference data screen ${receipt.screenId}.`,
    );
  }

  if (!currentReceipt || !sameScreenReceipt(receipt, currentReceipt)) {
    throw new UnsafeInferenceDispatchError(
      "Unsafe inference dispatch: stale inference data screen receipt; re-route the current payload.",
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

function sameScreenReceipt(
  routed: InferenceDataScreenReceipt,
  current: InferenceDataScreenReceipt,
): boolean {
  return (
    current.schemaVersion === "inference-data-screen/v1" &&
    current.rawPayloadStored === false &&
    routed.screenId === current.screenId &&
    routed.inputHash === current.inputHash &&
    routed.policyEffect === current.policyEffect &&
    routed.routeEffect === current.routeEffect &&
    routed.destinationClass === current.destinationClass &&
    routed.transformation === current.transformation &&
    sameStrings(routed.decisionIds, current.decisionIds) &&
    sameStrings(routed.classifiedDataClasses, current.classifiedDataClasses) &&
    sameStrings(routed.explanationCodes, current.explanationCodes) &&
    sameStrings(routed.obligationKinds, current.obligationKinds) &&
    Array.isArray(current.decisionVersions) &&
    sameDecisionVersions(routed.decisionVersions, current.decisionVersions)
  );
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function sameDecisionVersions(
  left: InferenceDataScreenReceipt["decisionVersions"],
  right: InferenceDataScreenReceipt["decisionVersions"],
): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort((a, b) => a.decisionId.localeCompare(b.decisionId));
  const sortedRight = [...right].sort((a, b) => a.decisionId.localeCompare(b.decisionId));
  return sortedLeft.every((version, index) => {
    const current = sortedRight[index];
    return (
      current !== undefined &&
      version.decisionId === current.decisionId &&
      isDecisionVersionSnapshotStillFresh(version, current)
    );
  });
}
