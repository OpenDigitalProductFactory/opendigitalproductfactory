// apps/web/lib/build/verification-preflight.ts
//
// BI-85433710 (EP-VERIFY-PROC) — deterministic verification preflight.
//
// Before a coworker attempts FUNCTIONAL verification of a build (driving the
// live UX / running tests against the install), this returns a deterministic
// verdict so the AI does not have to *reason* about testability. That reasoning
// is the recurring failure surface:
//   - claiming "verified" without actually testing (structural ≠ functional),
//   - re-testing when evidence already exists (wasted loops),
//   - trying to test a feature whose prerequisites aren't in place.
// Moving the judgment from cognitive to procedural is the EP-VERIFY-PROC intent.
//
//   MUST_ADVANCE — evidence is already sufficient; do NOT re-verify, advance.
//   BLOCKED      — a prerequisite is missing; cannot meaningfully test; surface
//                  the blocker (with a machine-readable code) instead of faking
//                  a result.
//   CAN_TEST     — install + required services + a build artifact are all ready;
//                  proceed to functional verification.
//
// Pure decision (this module) + signal gathering at the call site (typed against
// Prisma + the health probes), mirroring apps/web/lib/build/wip-cap.ts. Keeping
// the rule pure makes it trivially unit-testable and reusable by the review
// phase, an MCP tool, or a CI check without dragging in runtime deps.

export type PreflightVerdict = "MUST_ADVANCE" | "BLOCKED" | "CAN_TEST";

export type PreflightBlocker =
  | "install_unhealthy"
  | "services_unhealthy"
  | "no_build_artifact"
  | "explicit";

export type PreflightSignals = {
  /** acceptanceMet === true on the build — acceptance criteria already satisfied. */
  acceptanceAlreadyMet: boolean;
  /** A prior verification run already passed (verificationOut present + pass). */
  verificationAlreadyPassed: boolean;
  /** The portal/install answered its health check (e.g. GET /api/health = ok). */
  installHealthy: boolean;
  /** Services the test path needs (database, sandbox) are reachable. */
  requiredServicesHealthy: boolean;
  /** The build phase produced a testable artifact/diff — nothing to test otherwise. */
  buildArtifactPresent: boolean;
  /** An explicit blocker the caller already knows (e.g. provider down, quiescing). */
  explicitBlocker?: string | null;
};

export type PreflightResult = {
  verdict: PreflightVerdict;
  /** Plain-language explanation suitable to show the operator. */
  reason: string;
  /** Machine-readable blocker code when verdict === "BLOCKED", else null. */
  blocker: PreflightBlocker | null;
};

/**
 * Deterministic verification preflight. Order matters:
 *   1. If evidence is already sufficient, MUST_ADVANCE (never burn a re-test).
 *   2. Else, surface any hard blocker (explicit, then install, services,
 *      artifact) so the AI reports the blocker instead of fabricating a result.
 *   3. Else CAN_TEST.
 */
export function verificationPreflight(s: PreflightSignals): PreflightResult {
  // 1. Evidence already sufficient → do not re-verify.
  if (s.acceptanceAlreadyMet) {
    return {
      verdict: "MUST_ADVANCE",
      reason: "Acceptance criteria are already met — advance without re-testing.",
      blocker: null,
    };
  }
  if (s.verificationAlreadyPassed) {
    return {
      verdict: "MUST_ADVANCE",
      reason: "A prior verification run already passed — advance without re-testing.",
      blocker: null,
    };
  }

  // 2. Hard blockers — cannot meaningfully run a functional test.
  if (s.explicitBlocker && s.explicitBlocker.trim().length > 0) {
    return { verdict: "BLOCKED", reason: s.explicitBlocker.trim(), blocker: "explicit" };
  }
  if (!s.installHealthy) {
    return {
      verdict: "BLOCKED",
      reason: "The install isn't healthy (health check failed) — can't drive the live UX. Recover the portal before verifying.",
      blocker: "install_unhealthy",
    };
  }
  if (!s.requiredServicesHealthy) {
    return {
      verdict: "BLOCKED",
      reason: "A required service (database/sandbox) is unreachable — can't run a functional test. Restore it before verifying.",
      blocker: "services_unhealthy",
    };
  }
  if (!s.buildArtifactPresent) {
    return {
      verdict: "BLOCKED",
      reason: "No build artifact/diff to test yet — the build phase hasn't produced changes. Complete the build before verifying.",
      blocker: "no_build_artifact",
    };
  }

  // 3. Ready to test.
  return {
    verdict: "CAN_TEST",
    reason: "Install healthy, required services up, and a build artifact is present — proceed to functional verification (drive the live UX / run the tests).",
    blocker: null,
  };
}

/**
 * Convenience for prompt/UX surfaces: a one-line directive the coworker can act
 * on without interpreting the structured result.
 */
export function preflightDirective(r: PreflightResult): string {
  switch (r.verdict) {
    case "MUST_ADVANCE":
      return `MUST_ADVANCE — ${r.reason} Do not re-run verification; record the existing evidence and advance.`;
    case "BLOCKED":
      return `BLOCKED — ${r.reason} Report this blocker; do NOT claim a verification result you didn't produce.`;
    case "CAN_TEST":
      return `CAN_TEST — ${r.reason}`;
  }
}
