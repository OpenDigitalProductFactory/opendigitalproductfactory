import type { BuildFlowState, PromoteForkState, UpstreamForkState } from "@/lib/build-flow-state";
import type { FeatureBuildRow } from "@/lib/feature-build-types";

export type ReleaseDecisionTone = "neutral" | "ready" | "success" | "warning" | "danger";

export type ReleaseDecisionCard = {
  title: "Community Sharing" | "Release Readiness" | "Deployment Timing";
  label: string;
  tone: ReleaseDecisionTone;
  summary: string;
  detail: string;
};

function hasReleaseDiff(build: FeatureBuildRow): boolean {
  return typeof build.diffPatch === "string" && build.diffPatch.trim().length > 0;
}

export function isMissingReleasableDiffError(message: string | null | undefined): boolean {
  return typeof message === "string"
    && message.includes("No releasable source changes were found in the sandbox");
}

function summarizeUpstreamState(state: UpstreamForkState): Pick<ReleaseDecisionCard, "label" | "tone" | "summary"> {
  switch (state) {
    case "shipped":
      return {
        label: "Shared upstream",
        tone: "success",
        summary: "A governed upstream pull request has been opened for this build.",
      };
    case "errored":
      return {
        label: "Attention needed",
        tone: "danger",
        summary: "The last upstream contribution attempt failed and needs review.",
      };
    case "skipped":
      return {
        label: "Kept private",
        tone: "neutral",
        summary: "This install is configured to keep shipped features private unless policy changes.",
      };
    case "in_progress":
      return {
        label: "Not submitted yet",
        tone: "warning",
        summary: "No upstream pull request is open yet for this ship-phase build.",
      };
    case "pending":
    default:
      return {
        label: "Not ready",
        tone: "neutral",
        summary: "Community sharing will appear after the build reaches release decisions.",
      };
  }
}

function summarizePromotionState(state: PromoteForkState): Pick<ReleaseDecisionCard, "label" | "tone" | "summary"> {
  switch (state) {
    case "shipped":
      return {
        label: "Deployed",
        tone: "success",
        summary: "The approved promotion has been deployed successfully.",
      };
    case "scheduled":
      return {
        label: "Scheduled",
        tone: "ready",
        summary: "The promotion is queued for the next deployment window.",
      };
    case "awaiting_operator":
      return {
        label: "Awaiting operator",
        tone: "warning",
        summary: "The promotion is approved, but a local operator still needs to execute it.",
      };
    case "rolled_back":
      return {
        label: "Rolled back",
        tone: "danger",
        summary: "The promotion was deployed and then rolled back.",
      };
    case "errored":
      return {
        label: "Attention needed",
        tone: "danger",
        summary: "The promotion failed and needs review before retrying.",
      };
    case "in_progress":
      return {
        label: "Promotion pending",
        tone: "warning",
        summary: "A promotion has not been registered or completed yet.",
      };
    case "pending":
    default:
      return {
        label: "Not ready",
        tone: "neutral",
        summary: "Promotion timing becomes actionable once the build reaches release decisions.",
      };
  }
}

export function deriveReleaseDecisionCards(
  build: FeatureBuildRow,
  flowState: BuildFlowState | null,
): ReleaseDecisionCard[] {
  const upstream = summarizeUpstreamState(flowState?.upstream.state ?? "pending");
  const promote = summarizePromotionState(flowState?.promote.state ?? "pending");
  const releaseReady =
    hasReleaseDiff(build) && !!build.digitalProductId
      ? {
        label: "Promotion created",
        tone: "success" as const,
        summary: "Release evidence is captured and the product registration is in place.",
      }
      : hasReleaseDiff(build)
        ? {
          label: "Ready to register",
          tone: "ready" as const,
          summary: "Diff and release evidence are ready. Create the governed promotion next.",
        }
        : {
          label: "Prepare release",
          tone: "warning" as const,
          summary: "Extract the sandbox diff and release evidence before shipping or contributing.",
        };

  return [
    {
      title: "Community Sharing",
      ...upstream,
      detail: flowState?.upstream.prUrl
        ? `Pull request: ${flowState.upstream.prUrl}`
        : flowState?.upstream.errorMessage ?? "Use this lane to decide whether the shipped change should be offered upstream.",
    },
    {
      title: "Release Readiness",
      ...releaseReady,
      detail: build.verificationOut?.typecheckPassed
        ? "Typecheck is clean and review acceptance is already recorded."
        : "Release readiness depends on clean verification evidence and recorded acceptance.",
    },
    {
      title: "Deployment Timing",
      ...promote,
      detail:
        flowState?.promote.scheduleDescription
        ?? flowState?.promote.errorMessage
        ?? (flowState?.promote.promotionId ? `Promotion: ${flowState.promote.promotionId}` : "Create a promotion to expose deployment timing controls."),
    },
  ];
}
