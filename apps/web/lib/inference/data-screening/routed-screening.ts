import type { ChatMessage } from "@/lib/inference/ai-inference";
import type { ActivityContract } from "@/lib/routing/activity-contract";
import {
  ContextMaskAuthorizationError,
  ContextMaskCoverageError,
  ContextMaskMaterialityError,
  maskForContext,
  type SensitiveDetailUse,
} from "@/lib/govern/data/mask-for-context";
import {
  screenInferencePayload,
  type ScreenInferencePayloadInput,
} from "./screen-inference-payload";

type RoutedScreenInput = {
  messages: ChatMessage[];
  systemPrompt: string;
  tools?: Array<Record<string, unknown>>;
  taskType: string;
  routeContext: ScreenInferencePayloadInput["routeContext"];
  activityContract?: ActivityContract;
  policyVersionSource?: ScreenInferencePayloadInput["policyVersionSource"];
  sensitiveDetailUse?: SensitiveDetailUse;
};

export function routedRehydrationHandle(rehydrationHandle?: string) {
  return rehydrationHandle ? { rehydrationHandle } : {};
}

export function createRoutedInferenceScreen(input: RoutedScreenInput) {
  const { sensitiveDetailUse = "unknown", ...baseInput } = input;
  const screenInput = { ...baseInput } satisfies ScreenInferencePayloadInput;
  const rawScreen = screenInferencePayload(screenInput);
  const directMaskDecision = rawScreen.decisions.find(hasMaskObligation);
  const projectionScreen = directMaskDecision
    ? null
    : screenInferencePayload({ ...screenInput, destinationClass: "in-process" });
  const maskDecision = directMaskDecision ??
    projectionScreen?.decisions.find(hasMaskObligation);

  if (!maskDecision) {
    return { screenInput, screen: rawScreen, rehydrationHandle: undefined };
  }

  try {
    const masked = maskForContext(
      {
        messages: screenInput.messages,
        systemPrompt: screenInput.systemPrompt,
        tools: screenInput.tools,
      },
      {
        decision: maskDecision,
        matches: rawScreen.classification.matches,
        detailUse: sensitiveDetailUse,
      },
    );
    const transformation = masked.transformation;
    if (transformation === "none") {
      return { screenInput, screen: rawScreen, rehydrationHandle: undefined };
    }

    const authorityReceipt = (projectionScreen ?? rawScreen).receipt;
    const appliedTransformation = transformationEvidence(
      authorityReceipt,
      rawScreen,
      transformation,
    );
    const appliedTransformationSource = () => {
      const refreshedRaw = screenInferencePayload(screenInput);
      const refreshedDirect = refreshedRaw.decisions.find(hasMaskObligation);
      const refreshedProjection = refreshedDirect
        ? null
        : screenInferencePayload({ ...screenInput, destinationClass: "in-process" });
      const refreshedDecision = refreshedDirect ??
        refreshedProjection?.decisions.find(hasMaskObligation);
      if (!refreshedDecision) throw new ContextMaskAuthorizationError();
      return transformationEvidence(
        (refreshedProjection ?? refreshedRaw).receipt,
        refreshedRaw,
        transformation,
      );
    };
    const transformedInput = {
      ...screenInput,
      messages: masked.value.messages,
      systemPrompt: masked.value.systemPrompt,
      tools: masked.value.tools,
      appliedTransformation,
      appliedTransformationSource,
    } satisfies ScreenInferencePayloadInput;
    return {
      screenInput: transformedInput,
      screen: screenInferencePayload(transformedInput),
      rehydrationHandle: masked.rehydrationHandle,
    };
  } catch (error) {
    if (
      error instanceof ContextMaskAuthorizationError ||
      error instanceof ContextMaskCoverageError ||
      error instanceof ContextMaskMaterialityError
    ) {
      return { screenInput, screen: rawScreen, rehydrationHandle: undefined };
    }
    throw error;
  }
}

function transformationEvidence(
  authorityReceipt: ReturnType<typeof screenInferencePayload>["receipt"],
  rawScreen: ReturnType<typeof screenInferencePayload>,
  transformation: "masked" | "tokenized",
): NonNullable<ScreenInferencePayloadInput["appliedTransformation"]> {
  return {
    transformation,
    decisionIds: authorityReceipt.decisionIds,
    decisionVersions: authorityReceipt.decisionVersions,
    classifiedDataClasses: rawScreen.receipt.classifiedDataClasses,
    explanationCodes: [
      ...authorityReceipt.explanationCodes,
      "payload-transformed-before-dispatch",
    ],
    obligationKinds: authorityReceipt.obligationKinds,
  };
}

function hasMaskObligation(
  decision: ReturnType<typeof screenInferencePayload>["decisions"][number],
): boolean {
  return decision.effect === "allow-with-obligations" &&
    decision.obligations.some((obligation) => obligation.kind === "mask");
}

export function rescreenRoutedInferenceWithoutTools(
  input: ScreenInferencePayloadInput,
) {
  return rescreenRoutedInferencePayload(input, { tools: undefined });
}

export function rescreenRoutedInferencePayload(
  input: ScreenInferencePayloadInput,
  payload: Partial<Pick<ScreenInferencePayloadInput, "messages" | "systemPrompt">> & {
    tools?: ScreenInferencePayloadInput["tools"];
  },
) {
  const screenInput = { ...input, ...payload } satisfies ScreenInferencePayloadInput;
  return {
    screenInput,
    receipt: screenInferencePayload(screenInput).receipt,
  };
}
