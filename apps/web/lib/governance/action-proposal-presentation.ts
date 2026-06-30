import {
  PROACTIVITY_CHANGE_ACTION,
  parseProactivityChangeProposalParameters,
} from "@/lib/proactivity/proactivity-change-proposal";
import { getProactivityLevelCopy } from "@/lib/proactivity/proactivity-copy";

export type ActionProposalPresentationInput = {
  proposalId: string;
  actionType: string;
  parameters: unknown;
};

export type ActionProposalPresentationDetail = {
  label: string;
  value: string;
};

export type ActionProposalPresentation = {
  title: string;
  shortLabel: string;
  summary: string;
  details: ActionProposalPresentationDetail[];
};

const ACTIVITY_HARNESS_CONFIDENCE_OVERRIDE_ACTION =
  "activity_harness_confidence_override";

export function projectActionProposalPresentation(
  input: ActionProposalPresentationInput,
): ActionProposalPresentation {
  if (input.actionType === PROACTIVITY_CHANGE_ACTION) {
    const parameters = parseProactivityChangeProposalParameters(input.parameters);
    if (parameters) {
      const current = getProactivityLevelCopy(parameters.currentLevel).label;
      const proposed = getProactivityLevelCopy(parameters.proposedLevel).label;

      return {
        title: `Change proactivity to ${proposed}`,
        shortLabel: "Proactivity change",
        summary: `Why now: ${parameters.rationale}`,
        details: [
          { label: "Current", value: current },
          { label: "Recommended", value: proposed },
          { label: "Scope", value: readableScope(parameters.scope, parameters.activityFamily ?? parameters.routeContext) },
          { label: "Spend", value: parameters.spendImpact },
          { label: "Authority", value: parameters.authorityImpact },
        ],
      };
    }
  }

  if (input.actionType === ACTIVITY_HARNESS_CONFIDENCE_OVERRIDE_ACTION) {
    const parameters = asRecord(input.parameters);
    const activityClass = readString(parameters?.activityClass) ?? "unknown activity";
    const harnessRecipeKey = readString(parameters?.harnessRecipeKey) ?? "unknown harness";
    const providerId = readString(parameters?.providerId) ?? "unknown provider";
    const modelId = readNullableString(parameters?.modelId) ?? "unknown model";
    const confidence = readString(parameters?.confidence) ?? "unknown confidence";

    return {
      title: "Tune activity routing confidence",
      shortLabel: "Activity routing tuning",
      summary: `Set ${activityClass} / ${harnessRecipeKey} on ${providerId}/${modelId} to ${confidence}.`,
      details: [
        { label: "Activity", value: activityClass },
        { label: "Harness", value: harnessRecipeKey },
        { label: "Provider", value: providerId },
        { label: "Model", value: modelId },
        { label: "Confidence", value: confidence },
      ],
    };
  }

  const label = humanizeActionType(input.actionType);
  return {
    title: label,
    shortLabel: label,
    summary: `Proposed action ${input.actionType}.`,
    details: [],
  };
}

function readableScope(scope: string, scopeRef?: string | null): string {
  const label = scope.replace(/-/g, " ");
  return scopeRef ? `${label}: ${scopeRef}` : label;
}

function humanizeActionType(actionType: string): string {
  const words = actionType.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "an action";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return readString(value);
}
