import type { VerificationDepth } from "@/lib/golden-triangle";
import type { BuildPhase } from "./feature-build-types";
import {
  normalizeSize,
  normalizeType,
  type BuildProcessSize,
  type BuildProcessType,
} from "./build-process-matrix";
import { checkVerificationDepthSatisfied } from "./verification-depth-requirement";

export type VerificationDepthShadowDecision = {
  transition: string;
  kind: BuildProcessType;
  processSize: BuildProcessSize;
  declaredDepth: VerificationDepth;
  wouldBlock: boolean;
  /** False when the transition runs before the evidence the depth table reads
   *  can exist. A not-yet-evaluable decision is not a pass (BI-4FF872FB). */
  evaluable: boolean;
  reason?: string;
};

/** Report-only evaluation, kept outside the lifecycle policy verdict loop. */
export function evaluateVerificationDepthShadow(
  from: BuildPhase,
  to: BuildPhase,
  evidence: Record<string, unknown>,
): VerificationDepthShadowDecision {
  const depth = evidence.verificationDepth === "shallow" || evidence.verificationDepth === "deep"
    ? evidence.verificationDepth
    : "none";
  const transition = `${from}->${to}`;
  const result = checkVerificationDepthSatisfied({
    ...evidence,
    verificationDepth: depth,
    transition,
  });
  return {
    transition,
    kind: normalizeType(evidence.kind as string | undefined),
    processSize: normalizeSize(evidence.processSize as string | undefined),
    declaredDepth: depth,
    wouldBlock: !result.allowed,
    evaluable: result.evaluable,
    ...(!result.allowed ? { reason: result.reason } : {}),
  };
}
