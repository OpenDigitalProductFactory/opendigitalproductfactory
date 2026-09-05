import type { ScreenInferencePayloadInput } from "./data-screening/screen-inference-payload";
import { screenInferencePayload } from "./data-screening/screen-inference-payload";
import type { InferenceDataScreenReceipt } from "./data-screening/types";
import { assertInferenceDispatchScreen } from "@/lib/routing/inference-dispatch-guard";
import { isLocalProviderId } from "@/lib/routing/provider-locality";
import type { RouteDecision, SensitivityLevel } from "@/lib/routing/types";

type PersistedScreenContext = Omit<
  ScreenInferencePayloadInput,
  | "messages"
  | "systemPrompt"
  | "tools"
  | "policyVersionSource"
  | "appliedTransformationSource"
  | "appliedTransformation"
>;

export type DurableDispatchScreenEvidence = {
  schemaVersion: 1;
  decision: {
    sensitivity: SensitivityLevel;
    policyRulesApplied: string[];
    inferenceDataScreenReceipt: InferenceDataScreenReceipt;
  };
  context: PersistedScreenContext;
};

const SCREEN_CONTEXT_KEYS = new Set([
  "organizationId",
  "systemPromptInstructionSpans",
  "messageOrigins",
  "taskType",
  "routeContext",
  "activityContract",
  "governedData",
  "destinationClass",
  "purpose",
]);

function record(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

function assertProviderAllowed(input: {
  providerId: string;
  receipt: InferenceDataScreenReceipt;
  localOnlyInference: boolean;
}): void {
  if (
    !isLocalProviderId(input.providerId)
    && (input.localOnlyInference || input.receipt.routeEffect === "local-only")
  ) {
    throw new Error("ASYNC_OPERATION_DISPATCH_LOCAL_ONLY");
  }
}

/**
 * Re-screen the exact provider payload immediately before durable admission,
 * then persist only the safe context needed to repeat that guard after restart.
 */
export function createDurableDispatchScreenEvidence(input: {
  decision: RouteDecision;
  screeningInput: ScreenInferencePayloadInput;
  messages: ScreenInferencePayloadInput["messages"];
  systemPrompt: string;
  tools?: ScreenInferencePayloadInput["tools"];
  providerId: string;
  localOnlyInference: boolean;
}): DurableDispatchScreenEvidence {
  if (
    input.screeningInput.policyVersionSource
    || input.screeningInput.appliedTransformationSource
    || input.screeningInput.appliedTransformation
  ) {
    throw new Error("ASYNC_OPERATION_SCREENING_SOURCE_NOT_DURABLE");
  }
  const currentInput = {
    ...input.screeningInput,
    messages: input.messages,
    systemPrompt: input.systemPrompt,
    tools: input.tools,
  };
  const receipt = screenInferencePayload(currentInput).receipt;
  assertInferenceDispatchScreen(input.decision, receipt);
  assertProviderAllowed({
    providerId: input.providerId,
    receipt,
    localOnlyInference: input.localOnlyInference,
  });
  const {
    messages: _messages,
    systemPrompt: _systemPrompt,
    tools: _tools,
    policyVersionSource: _policyVersionSource,
    appliedTransformationSource: _appliedTransformationSource,
    appliedTransformation: _appliedTransformation,
    ...context
  } = currentInput;
  return {
    schemaVersion: 1,
    decision: {
      sensitivity: input.decision.sensitivity,
      policyRulesApplied: [...input.decision.policyRulesApplied],
      inferenceDataScreenReceipt: receipt,
    },
    context,
  };
}

export function parseDurableDispatchScreenEvidence(
  value: unknown,
): DurableDispatchScreenEvidence {
  const evidence = record(value, "ASYNC_OPERATION_DISPATCH_SCREEN_INVALID");
  const decision = record(evidence["decision"], "ASYNC_OPERATION_DISPATCH_SCREEN_INVALID");
  const receipt = record(
    decision["inferenceDataScreenReceipt"],
    "ASYNC_OPERATION_DISPATCH_SCREEN_INVALID",
  );
  const context = record(evidence["context"], "ASYNC_OPERATION_DISPATCH_SCREEN_INVALID");
  const sensitivity = decision["sensitivity"];
  const rules = decision["policyRulesApplied"];
  if (
    evidence["schemaVersion"] !== 1
    || !["public", "internal", "confidential", "restricted", "development"].includes(String(sensitivity))
    || !Array.isArray(rules)
    || rules.some((rule) => typeof rule !== "string")
    || receipt["schemaVersion"] !== "inference-data-screen/v1"
    || Object.keys(context).some((key) => !SCREEN_CONTEXT_KEYS.has(key))
  ) {
    throw new Error("ASYNC_OPERATION_DISPATCH_SCREEN_INVALID");
  }
  return evidence as unknown as DurableDispatchScreenEvidence;
}

/** Re-run the persisted screen at the last possible pre-provider boundary. */
export function assertDurableDispatchScreen(input: {
  evidence: DurableDispatchScreenEvidence;
  messages: ScreenInferencePayloadInput["messages"];
  systemPrompt: string;
  tools?: ScreenInferencePayloadInput["tools"];
  providerId: string;
  localOnlyInference: boolean;
}): void {
  const currentReceipt = screenInferencePayload({
    ...input.evidence.context,
    messages: input.messages,
    systemPrompt: input.systemPrompt,
    tools: input.tools,
  }).receipt;
  assertInferenceDispatchScreen(input.evidence.decision, currentReceipt);
  assertProviderAllowed({
    providerId: input.providerId,
    receipt: currentReceipt,
    localOnlyInference: input.localOnlyInference,
  });
}
