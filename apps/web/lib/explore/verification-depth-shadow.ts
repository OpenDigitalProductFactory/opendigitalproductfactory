import type { VerificationDepth } from "@/lib/golden-triangle";
import type { BuildPhase } from "./feature-build-types";
import {
  checkRequirement,
  normalizeSize,
  normalizeType,
  type BuildProcessSize,
  type BuildProcessType,
} from "./build-process-matrix";

export type VerificationDepthShadowDecision = {
  transition: string;
  kind: BuildProcessType;
  processSize: BuildProcessSize;
  declaredDepth: VerificationDepth;
  wouldBlock: boolean;
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
  const result = checkRequirement("verification-depth-satisfied", {
    ...evidence,
    verificationDepth: depth,
  });
  return {
    transition: `${from}->${to}`,
    kind: normalizeType(evidence.kind as string | undefined),
    processSize: normalizeSize(evidence.processSize as string | undefined),
    declaredDepth: depth,
    wouldBlock: !result.allowed,
    ...(!result.allowed ? { reason: result.reason } : {}),
  };
}
