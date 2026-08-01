import type { BuildStudioCustomerStatus } from "./customer-status-projection";
import { normalizeVerificationOutput } from "./verification-output";
import type { BuildPhase, FeatureBuildRow } from "@/lib/feature-build-types";
import type { BusinessBuildBrief } from "./business-build-brief";

export const OWNER_PROOF_STATES = [
  "passed",
  "failed",
  "not-applicable",
  "not-recorded",
  "stale",
] as const;

export type OwnerProofState = typeof OWNER_PROOF_STATES[number];

export type OwnerProofCheck = {
  key: "acceptance" | "automated" | "ux";
  label: string;
  state: OwnerProofState;
  summary: string;
  observedAt: string | null;
};

export type OwnerProofPacket = {
  requestedOutcome: string;
  whatChanged: string | null;
  checks: OwnerProofCheck[];
  openRisks: string[];
};

export type OwnerChangeView = {
  changeId: string;
  title: string;
  outcome: string;
  now: string;
  next: string;
  health: "working" | "waiting" | "needs-you" | "blocked" | "ready" | "live";
  brief: BusinessBuildBrief | null;
  proof: OwnerProofPacket;
  pendingDecisionId: string | null;
  preview: { available: boolean; drivingThisChange: boolean };
  technicalDetailsAvailable: boolean;
};

const EVIDENCE_WRITE_GRACE_MS = 5 * 60 * 1000;

type OwnerStatus = Pick<BuildStudioCustomerStatus, "lifecyclePosition" | "nextAction" | "needsYou">;

export function projectOwnerChangeView(input: {
  build: FeatureBuildRow;
  status?: OwnerStatus | null;
  previewDrivingBuildId?: string | null;
}): OwnerChangeView {
  const { build, status } = input;
  const outcome = firstText(
    build.businessBuildBrief?.businessOutcome,
    build.designDoc?.problemStatement,
    build.description,
    build.originator?.resolution,
    build.title,
  );
  const previewAvailable =
    build.sandboxPort !== null && ["build", "review", "ship"].includes(build.phase);
  const pendingDecision = build.decisionInteraction;

  return {
    changeId: build.buildId,
    title: build.title,
    outcome,
    now: status?.lifecyclePosition ?? fallbackNow(build.phase),
    next: status?.nextAction ?? fallbackNext(build.phase),
    health: projectHealth(build.phase, status?.needsYou === true),
    brief: build.businessBuildBrief ?? null,
    proof: {
      requestedOutcome: outcome,
      whatChanged: firstTextOrNull(build.diffSummary),
      checks: [
        acceptanceCheck(build),
        automatedCheck(build),
        uxCheck(build),
      ],
      openRisks: build.businessBuildBrief?.openQuestions ?? [],
    },
    pendingDecisionId:
      pendingDecision && !pendingDecision.chosenOptionId
        ? pendingDecision.interactionId
        : null,
    preview: {
      available: previewAvailable,
      drivingThisChange:
        previewAvailable && input.previewDrivingBuildId === build.buildId,
    },
    technicalDetailsAvailable: true,
  };
}

function acceptanceCheck(build: FeatureBuildRow): OwnerProofCheck {
  if (build.phase === "ideate" || build.phase === "plan" || build.phase === "build") {
    return proof("acceptance", "Outcome checks", "not-applicable", "Checked during review.");
  }
  const criteria = build.acceptanceMet;
  if (!criteria?.length) {
    return proof("acceptance", "Outcome checks", "not-recorded", "No outcome-check result is recorded.");
  }
  const failed = criteria.filter((criterion) => !criterion.met).length;
  return failed > 0
    ? proof("acceptance", "Outcome checks", "failed", `${failed} outcome check${failed === 1 ? "" : "s"} did not pass.`)
    : proof("acceptance", "Outcome checks", "passed", `${criteria.length} outcome check${criteria.length === 1 ? "" : "s"} passed.`);
}

function automatedCheck(build: FeatureBuildRow): OwnerProofCheck {
  if (build.phase === "ideate" || build.phase === "plan") {
    return proof("automated", "Automated checks", "not-applicable", "Checks start after the plan is approved.");
  }
  const verification = normalizeVerificationOutput(build.verificationOut);
  if (
    verification.typecheckPassed === null
    || verification.testsPassed === null
    || verification.testsFailed === null
  ) {
    return proof("automated", "Automated checks", "not-recorded", "No complete automated-check result is recorded.");
  }
  if (!verification.typecheckPassed || verification.testsFailed > 0) {
    return proof(
      "automated",
      "Automated checks",
      "failed",
      !verification.typecheckPassed
        ? "The production type check failed."
        : `${verification.testsFailed} automated test${verification.testsFailed === 1 ? "" : "s"} failed.`,
      verification.observedAt,
    );
  }
  if (isOlderThanBuild(verification.observedAt, build.updatedAt)) {
    return proof("automated", "Automated checks", "stale", "The Change was updated after these checks ran.", verification.observedAt);
  }
  return proof(
    "automated",
    "Automated checks",
    "passed",
    `${verification.testsPassed ?? 0} automated test${verification.testsPassed === 1 ? "" : "s"} passed and the production type check passed.`,
    verification.observedAt,
  );
}

function uxCheck(build: FeatureBuildRow): OwnerProofCheck {
  if (build.uxVerificationStatus === "skipped") {
    return proof("ux", "Experience review", "not-applicable", "Experience review was explicitly marked not applicable.");
  }
  if (build.phase === "ideate" || build.phase === "plan" || build.phase === "build") {
    return proof("ux", "Experience review", "not-applicable", "Experience review happens after implementation.");
  }
  if (!build.uxVerificationStatus || build.uxVerificationStatus === "running") {
    return proof("ux", "Experience review", "not-recorded", "No completed experience-review result is recorded.");
  }
  const failed = build.uxTestResults?.filter((result) => !result.passed).length ?? 0;
  if (build.uxVerificationStatus === "failed" || failed > 0) {
    return proof("ux", "Experience review", "failed", failed > 0 ? `${failed} experience check${failed === 1 ? "" : "s"} failed.` : "Experience review failed.");
  }
  return proof("ux", "Experience review", "passed", "The recorded experience review passed.");
}

function proof(
  key: OwnerProofCheck["key"],
  label: string,
  state: OwnerProofState,
  summary: string,
  observedAt: string | null = null,
): OwnerProofCheck {
  return { key, label, state, summary, observedAt };
}

function isOlderThanBuild(observedAt: string | null, updatedAt: Date): boolean {
  if (!observedAt) return false;
  const observedTime = Date.parse(observedAt);
  return Number.isFinite(observedTime)
    && observedTime + EVIDENCE_WRITE_GRACE_MS < updatedAt.getTime();
}

function projectHealth(phase: BuildPhase, needsYou: boolean): OwnerChangeView["health"] {
  if (needsYou) return "needs-you";
  if (phase === "complete") return "live";
  if (phase === "ship") return "ready";
  if (phase === "failed" || phase === "abandoned") return "blocked";
  return "working";
}

function fallbackNow(phase: BuildPhase): string {
  const labels: Record<BuildPhase, string> = {
    ideate: "Understanding the outcome",
    plan: "Shaping the approach",
    build: "Building the change",
    review: "Checking the work",
    ship: "Ready for a release decision",
    complete: "Live",
    failed: "Blocked by a problem",
    abandoned: "Work stopped",
  };
  return labels[phase];
}

function fallbackNext(phase: BuildPhase): string {
  if (phase === "complete") return "Review whether the outcome improves as expected.";
  if (phase === "failed") return "Resolve the blocker before work continues.";
  if (phase === "abandoned") return "Resume only if this outcome is still valuable.";
  if (phase === "ship") return "Review the proof before release.";
  return "No action is needed unless Build Studio asks for a decision.";
}

function firstText(...values: Array<string | null | undefined>): string {
  return firstTextOrNull(...values) ?? "Outcome not recorded yet.";
}

function firstTextOrNull(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}
