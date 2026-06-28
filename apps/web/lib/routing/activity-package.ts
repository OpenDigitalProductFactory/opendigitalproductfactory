import type { WorkPatternMetadata } from "@/lib/tak/work-pattern-types";
import type {
  ActivityContract,
  ActivityParentRef,
  ActivityRouteContext,
} from "./activity-contract";
import { routeContextFromActivity } from "./activity-compiler";
import {
  bindHarnessRecipeForActivity,
  type HarnessRecipe,
} from "./harness-recipe";

export type ActivityPackageReadiness = {
  state: "ready" | "blocked";
  reason: string;
};

export type ActivityPackageRouteContext = ActivityRouteContext & {
  providerReadiness?: "ready" | "credential-gated";
  receiptPolicy?: NonNullable<WorkPatternMetadata["workCaseBinding"]>["receiptPolicy"];
  workCaseTransition?: string;
};

export type ActivityPackage = {
  activity: ActivityContract;
  harness: HarnessRecipe | null;
  routeContext: ActivityPackageRouteContext;
  readiness: ActivityPackageReadiness;
};

export type BuildGlmActivityPilotPackageInput = {
  pilotId: string;
  parentRef: ActivityParentRef;
  credentialReady: boolean;
};

export type BuildWorkCaseActivityPilotPackageInput = {
  metadata: WorkPatternMetadata;
  title: string;
};

export function buildGlmActivityPilotPackage(
  input: BuildGlmActivityPilotPackageInput,
): ActivityPackage {
  const activity: ActivityContract = {
    activityId: `pilot:glm:${input.pilotId}`,
    parentRef: input.parentRef,
    activityClass: "summarize",
    title: "Evaluate GLM center-distribution summary",
    distributionShape: "center",
    riskClass: "low",
    successShape: "text",
    contextPolicy: "retrieval",
    tokenEnvelope: {
      maxInputTokens: 64_000,
      maxOutputTokens: 2_000,
      compression: "summarize",
    },
    evaluationPolicy: {
      evaluator: "human-acceptance",
      minimumSignal: "accepted",
    },
    requestContractHints: {
      taskType: "summarization",
      budgetClass: "minimize_cost",
      reasoningDepth: "low",
      minimumTier: "adequate",
      residencyPolicy: "approved_cloud",
    },
  };
  const harness = bindHarnessRecipeForActivity(activity, {
    providerId: "zai",
    modelId: "glm-5.2",
  });

  return {
    activity,
    harness,
    routeContext: {
      ...routeContextFromActivity(activity),
      providerReadiness: input.credentialReady ? "ready" : "credential-gated",
    },
    readiness: input.credentialReady
      ? {
          state: "ready",
          reason: "Z.ai / GLM credentials are ready for provisional challenger evaluation.",
        }
      : {
          state: "blocked",
          reason:
            "Z.ai / GLM credentials or entitlement are not ready; keep GLM as a provisional challenger.",
        },
  };
}

export function buildWorkCaseActivityPilotPackage(
  input: BuildWorkCaseActivityPilotPackageInput,
): ActivityPackage {
  const firstEvidence = input.metadata.evidence?.[0];
  const activity: ActivityContract = {
    activityId: `pilot:work-case:${input.metadata.patternKey}`,
    parentRef: {
      taskRunId: firstEvidence?.taskRunId,
      workCaseId: firstEvidence?.workCaseRef,
      patternKey: input.metadata.patternKey,
    },
    activityClass: "tool-act",
    title: input.title,
    distributionShape: "mixed",
    riskClass: "medium",
    successShape: "tool-result",
    contextPolicy: "work-case-packet",
    tokenEnvelope: {
      maxInputTokens: 32_000,
      maxOutputTokens: 2_000,
      compression: "strict-packet",
    },
    evaluationPolicy: {
      evaluator: "human-acceptance",
      minimumSignal: "accepted",
    },
    requestContractHints: {
      taskType: "tool-action",
      budgetClass: "balanced",
      reasoningDepth: "medium",
      minimumTier: "strong",
    },
  };
  const routeContext = routeContextFromActivity(activity);
  const readiness = workCaseReadiness(input.metadata);

  return {
    activity,
    harness: bindHarnessRecipeForActivity(activity),
    routeContext: {
      ...routeContext,
      receiptPolicy: input.metadata.workCaseBinding?.receiptPolicy,
      workCaseTransition: input.metadata.workCaseBinding?.transitionKey,
    },
    readiness,
  };
}

function workCaseReadiness(metadata: WorkPatternMetadata): ActivityPackageReadiness {
  if (
    metadata.workCaseBinding?.governedActionKey &&
    metadata.workCaseBinding.receiptPolicy &&
    metadata.evidence?.some((evidence) => evidence.workCaseRef && evidence.receiptId)
  ) {
    return {
      state: "ready",
      reason: "Work Case pattern has governed action, receipt policy, and case evidence.",
    };
  }

  return {
    state: "blocked",
    reason:
      "Work Case pattern needs governed action, receipt policy, and case evidence before activity routing can tune it.",
  };
}
