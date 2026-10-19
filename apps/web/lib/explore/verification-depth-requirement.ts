import type { VerificationDepth } from "@/lib/golden-triangle";

type RequirementResult =
  | { allowed: true; evaluable: boolean }
  | { allowed: false; reason: string; evaluable: boolean };

/**
 * Transitions whose evidence bag can carry a verification run. `verificationOut`
 * is produced during the build phase, so before it the depth table has nothing
 * to assert against and MUST report not-yet-evaluable rather than a block.
 *
 * BI-4FF872FB: asserting on it earlier produced a guaranteed false positive —
 * 250 of 250 shadow records on the canonical runtime, every one at ideate->plan,
 * every one blocking on a typecheck that could not yet exist. Decision
 * DI-A940A9467E9E chose this phase-aware shape over scoping the requirement to
 * post-build transitions, so a later phase can add earlier-transition evidence
 * (a design- or plan-review depth signal) without re-scoping the requirement.
 *
 * An absent or unrecognised transition is treated as evaluable: a caller that
 * does not say where it is gets the full table, never a silent pass.
 */
const TRANSITIONS_WITHOUT_VERIFICATION_EVIDENCE = new Set(["ideate->plan", "plan->build"]);

/** Pure observed-evidence check for the verification-depth requirement. */
export function checkVerificationDepthSatisfied(
  evidence: Record<string, unknown>,
): RequirementResult {
  const depth = evidence.verificationDepth as VerificationDepth | undefined;
  if (depth !== "shallow" && depth !== "deep") return { allowed: true, evaluable: true };

  const transition = typeof evidence.transition === "string" ? evidence.transition : undefined;
  if (transition && TRANSITIONS_WITHOUT_VERIFICATION_EVIDENCE.has(transition)) {
    return { allowed: true, evaluable: false };
  }

  const verification = evidence.verificationOut as {
    testsFailed?: number;
    typecheckPassed?: boolean;
  } | null | undefined;
  if (!verification?.typecheckPassed) {
    return {
      allowed: false,
      reason: `${depth} verification requires a passing typecheck.`,
      evaluable: true,
    };
  }
  if (verification.testsFailed !== 0) {
    return {
      allowed: false,
      reason: `${depth} verification requires zero failed tests.`,
      evaluable: true,
    };
  }
  if (depth === "shallow") return { allowed: true, evaluable: true };

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
  if (goldenJourneyPassed || uxPassed) return { allowed: true, evaluable: true };
  return {
    allowed: false,
    reason: "Deep verification requires a passing mechanical verdict on the real path.",
    evaluable: true,
  };
}

/**
 * Gate-facing view of the same check. `evaluable` is shadow-report metadata,
 * not a verdict, so it is dropped here and the shared RequirementResult
 * contract the phase gate composes stays exactly {allowed, reason?}.
 */
export function checkVerificationDepthRequirement(
  evidence: Record<string, unknown>,
): { allowed: true } | { allowed: false; reason: string } {
  const { evaluable: _evaluable, ...result } = checkVerificationDepthSatisfied(evidence);
  return result;
}
