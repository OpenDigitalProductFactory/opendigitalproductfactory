import type { BuildFlowState, PromoteFork, UpstreamFork } from "@/lib/build-flow-state";
import type { FeatureBuildRow } from "@/lib/feature-build-types";

export type ReleaseDecisionTone = "neutral" | "info" | "success" | "warning" | "danger";

export type ReleaseDecisionSummary = {
  title: string;
  statusLabel: string;
  detail: string;
  nextAction: string;
  tone: ReleaseDecisionTone;
  href?: string;
  artifacts: string[];
};

export function describeUpstreamFork(fork: UpstreamFork): ReleaseDecisionSummary {
  switch (fork.state) {
    case "skipped":
      return {
        title: "Community Sharing",
        statusLabel: "Kept private",
        detail: "This build is staying private for now, so no community pull request was opened.",
        nextAction: "Share later if the feature becomes reusable and safe to upstream.",
        tone: "neutral",
        artifacts: buildArtifacts([
          fork.packId ? `Feature pack: ${fork.packId}` : null,
        ]),
      };
    case "in_progress":
      return {
        title: "Community Sharing",
        statusLabel: "Preparing share",
        detail: "Build Studio is still packaging or waiting for the final contribution dispatch step.",
        nextAction: "Confirm whether this should be shared once the OAuth-backed contribution flow is ready.",
        tone: "info",
        artifacts: buildArtifacts([
          fork.packId ? `Feature pack: ${fork.packId}` : null,
        ]),
      };
    case "shipped":
      return {
        title: "Community Sharing",
        statusLabel: fork.prNumber ? `PR #${fork.prNumber} open` : "PR open",
        detail: "A community contribution has been opened and is ready for external review.",
        nextAction: "Track feedback on the pull request and decide when to merge or follow up.",
        tone: "success",
        href: fork.prUrl ?? undefined,
        artifacts: buildArtifacts([
          fork.packId ? `Feature pack: ${fork.packId}` : null,
          fork.prUrl ? `Pull request: ${fork.prUrl}` : null,
        ]),
      };
    case "errored":
      return {
        title: "Community Sharing",
        statusLabel: "Attention needed",
        detail: fork.errorMessage
          ? `Community sharing was attempted, but it failed: ${fork.errorMessage}`
          : "Community sharing was attempted, but it failed before the pull request could be opened.",
        nextAction: "Review the contribution logs, correct the issue, and retry once the upstream path is healthy.",
        tone: "danger",
        artifacts: buildArtifacts([
          fork.packId ? `Feature pack: ${fork.packId}` : null,
          fork.errorMessage ? `Failure: ${fork.errorMessage}` : null,
        ]),
      };
    case "pending":
    default:
      return {
        title: "Community Sharing",
        statusLabel: "Not started",
        detail: "Community sharing has not started yet for this build.",
        nextAction: "Decide whether to keep the feature private or prepare it for upstream sharing.",
        tone: "neutral",
        artifacts: [],
      };
  }
}

export function describePromoteFork(fork: PromoteFork): ReleaseDecisionSummary {
  switch (fork.state) {
    case "scheduled":
      return {
        title: "Deployment Timing",
        statusLabel: "Scheduled",
        detail: fork.scheduleDescription
          ? `The production promotion has been scheduled: ${fork.scheduleDescription}.`
          : "The production promotion has been scheduled for a later deployment window.",
        nextAction: "Monitor the scheduled window and confirm the deployment completes as expected.",
        tone: "info",
        artifacts: buildArtifacts([
          fork.promotionId ? `Promotion: ${fork.promotionId}` : null,
          fork.scheduleDescription ? `Schedule: ${fork.scheduleDescription}` : null,
        ]),
      };
    case "awaiting_operator":
      return {
        title: "Deployment Timing",
        statusLabel: "Operator action required",
        detail: "The release is prepared, but an operator still needs to execute or confirm the production change.",
        nextAction: "Complete the operator handoff and run the promotion when the window is open.",
        tone: "warning",
        artifacts: buildArtifacts([
          fork.promotionId ? `Promotion: ${fork.promotionId}` : null,
        ]),
      };
    case "shipped":
      return {
        title: "Deployment Timing",
        statusLabel: "Deployed",
        detail: fork.deployedAt
          ? `The production promotion completed on ${fork.deployedAt.toISOString().slice(0, 10)}.`
          : "The production promotion completed successfully.",
        nextAction: "Monitor the live outcome and tee up any follow-on work from production feedback.",
        tone: "success",
        artifacts: buildArtifacts([
          fork.promotionId ? `Promotion: ${fork.promotionId}` : null,
          fork.deployedAt ? `Deployed at: ${fork.deployedAt.toISOString()}` : null,
        ]),
      };
    case "rolled_back":
      return {
        title: "Deployment Timing",
        statusLabel: "Rolled back",
        detail: fork.rollbackReason
          ? `The production change was rolled back: ${fork.rollbackReason}`
          : "The production change was rolled back after deployment.",
        nextAction: "Review the rollback reason, update the build, and only reattempt once the issue is understood.",
        tone: "danger",
        artifacts: buildArtifacts([
          fork.promotionId ? `Promotion: ${fork.promotionId}` : null,
          fork.rollbackReason ? `Rollback reason: ${fork.rollbackReason}` : null,
        ]),
      };
    case "errored":
      return {
        title: "Deployment Timing",
        statusLabel: "Deployment failed",
        detail: fork.errorMessage
          ? `The production change failed: ${fork.errorMessage}`
          : "The production change failed before reaching a stable deployed state.",
        nextAction: "Inspect the deployment evidence, fix the blocker, and retry inside an approved window.",
        tone: "danger",
        artifacts: buildArtifacts([
          fork.promotionId ? `Promotion: ${fork.promotionId}` : null,
          fork.errorMessage ? `Failure: ${fork.errorMessage}` : null,
        ]),
      };
    case "in_progress":
      return {
        title: "Deployment Timing",
        statusLabel: "Ready to run",
        detail: "The production promotion record exists, but the operational change has not completed yet.",
        nextAction: "Check the deployment window and run the promotion when approvals and timing are aligned.",
        tone: "info",
        artifacts: buildArtifacts([
          fork.promotionId ? `Promotion: ${fork.promotionId}` : null,
        ]),
      };
    case "pending":
    default:
      return {
        title: "Deployment Timing",
        statusLabel: "Awaiting release record",
        detail: "The production change path has not been prepared yet for this build.",
        nextAction: "Register the release record before scheduling or executing a production promotion.",
        tone: "neutral",
        artifacts: [],
      };
  }
}

export function describeReleaseReadiness(
  build: FeatureBuildRow,
  flowState: BuildFlowState | null,
): ReleaseDecisionSummary {
  const reviewNode = flowState?.mainTrack.find((node) => node.phase === "review");
  const acceptanceMet = Array.isArray(build.acceptanceMet)
    ? build.acceptanceMet.filter((criterion) => criterion.met).length
    : 0;
  const acceptanceTotal = Array.isArray(build.acceptanceMet) ? build.acceptanceMet.length : 0;
  const verificationPassed = build.verificationOut?.typecheckPassed === true
    && (build.verificationOut?.testsFailed ?? 0) === 0;
  const previewAvailable = build.sandboxPort != null;
  const uxState = build.uxVerificationStatus ?? "pending";

  const statusLabel =
    build.phase === "review"
      ? "In review"
      : verificationPassed && uxState === "complete"
        ? "Ready for approvals"
        : "Needs review";

  const tone: ReleaseDecisionTone =
    statusLabel === "Ready for approvals"
      ? "success"
      : build.phase === "review"
        ? "info"
        : "warning";

  return {
    title: "Release Readiness",
    statusLabel,
    detail: previewAvailable
      ? "A sandbox preview is available so reviewers can validate behavior before anything reaches production."
      : "Sandbox evidence is still being assembled before the release can be reviewed safely.",
    nextAction:
      statusLabel === "Ready for approvals"
        ? "Review the sandbox behavior, related evidence, and release decisions before moving into operational change."
        : "Finish the remaining verification and sandbox review before approving release actions.",
    tone,
    artifacts: buildArtifacts([
      previewAvailable ? "Sandbox preview available" : null,
      reviewNode ? `Review checks: ${reviewNode.stepsCompleted}/${reviewNode.stepsTotal}` : null,
      build.verificationOut ? `Typecheck: ${build.verificationOut.typecheckPassed ? "pass" : "fail"}` : null,
      acceptanceTotal > 0 ? `Acceptance criteria: ${acceptanceMet}/${acceptanceTotal}` : null,
      build.uxVerificationStatus ? `UX verification: ${build.uxVerificationStatus}` : null,
    ]),
  };
}

function buildArtifacts(lines: Array<string | null | undefined>): string[] {
  return lines.filter((line): line is string => Boolean(line));
}
