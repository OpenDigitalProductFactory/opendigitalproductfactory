import type { VerificationDepth } from "@/lib/golden-triangle";

type RequirementResult = { allowed: true } | { allowed: false; reason: string };

/** Pure observed-evidence check for the verification-depth requirement. */
export function checkVerificationDepthSatisfied(
  evidence: Record<string, unknown>,
): RequirementResult {
  const depth = evidence.verificationDepth as VerificationDepth | undefined;
  if (depth !== "shallow" && depth !== "deep") return { allowed: true };
  const verification = evidence.verificationOut as {
    testsFailed?: number;
    typecheckPassed?: boolean;
  } | null | undefined;
  if (!verification?.typecheckPassed) {
    return { allowed: false, reason: `${depth} verification requires a passing typecheck.` };
  }
  if (verification.testsFailed !== 0) {
    return { allowed: false, reason: `${depth} verification requires zero failed tests.` };
  }
  if (depth === "shallow") return { allowed: true };

  const goldenJourney = evidence.goldenJourneyResult as {
    journeyId?: unknown;
    passed?: unknown;
  } | null | undefined;
  const goldenJourneyPassed = goldenJourney?.passed === true
    && typeof goldenJourney.journeyId === "string"
    && goldenJourney.journeyId.trim().length > 0;
  const uxResults = Array.isArray(evidence.uxTestResults)
    ? evidence.uxTestResults as Array<{ step?: unknown; passed?: unknown }>
    : [];
  const uxPassed = evidence.uxVerificationStatus === "complete"
    && uxResults.length > 0
    && uxResults.every((result) =>
      result.passed === true
      && typeof result.step === "string"
      && result.step.trim().length > 0);
  if (goldenJourneyPassed || uxPassed) return { allowed: true };
  return {
    allowed: false,
    reason: "Deep verification requires a passing mechanical verdict on the real path.",
  };
}
