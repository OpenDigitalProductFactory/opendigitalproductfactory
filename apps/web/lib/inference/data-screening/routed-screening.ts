import type { ChatMessage } from "@/lib/inference/ai-inference";
import type { ActivityContract } from "@/lib/routing/activity-contract";
import {
  ContextMaskAuthorizationError,
  ContextMaskCoverageError,
  ContextMaskMaterialityError,
  maskForContext,
  type SensitiveDetailUse,
} from "@/lib/govern/data/mask-for-context";
import type {
  RehydrationAuthorizationBinding,
  RehydrationRouteBinding,
} from "@/lib/govern/data/rehydration-token-vault";
import {
  screenInferencePayload,
  type ScreenInferencePayloadInput,
} from "./screen-inference-payload";
import type { MessageOrigin } from "./types";

type RoutedScreenInput = {
  messages: ChatMessage[];
  systemPrompt: string;
  /** Platform-authored instruction spans within `systemPrompt` (BI-463BE12A). */
  systemPromptInstructionSpans?: string[];
  /** Positional labels for `messages` (BI-40EF7C44). Labels only, never content. */
  messageOrigins?: readonly MessageOrigin[];
  tools?: Array<Record<string, unknown>>;
  taskType: string;
  routeContext: ScreenInferencePayloadInput["routeContext"];
  activityContract?: ActivityContract;
  policyVersionSource?: ScreenInferencePayloadInput["policyVersionSource"];
  sensitiveDetailUse?: SensitiveDetailUse;
  responseRehydration?: RehydrationRouteBinding | readonly RehydrationRouteBinding[];
};

export class ResponseRehydrationBindingError extends Error {
  constructor() {
    super("Response rehydration bindings must share one actor, purpose, and surface.");
    this.name = "ResponseRehydrationBindingError";
  }
}

export function routedRehydrationHandle(rehydrationHandle?: string) {
  return rehydrationHandle ? { rehydrationHandle } : {};
}

export function createRoutedInferenceScreen(input: RoutedScreenInput) {
  const {
    sensitiveDetailUse = "unknown",
    responseRehydration,
    ...baseInput
  } = input;
  const routeBindings = normalizeRouteBindings(responseRehydration);
  const screenInput = {
    ...baseInput,
    ...(routeBindings[0] ? { purpose: routeBindings[0].purpose } : {}),
  } satisfies ScreenInferencePayloadInput;
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
    const authorityReceipt = (projectionScreen ?? rawScreen).receipt;
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
        ...(routeBindings.length > 0
          ? {
              rehydrationBindings: bindingsFromScreen(
                routeBindings,
                rawScreen,
                authorityReceipt,
              ),
            }
          : {}),
      },
    );
    const transformation = masked.transformation;
    if (transformation === "none") {
      return { screenInput, screen: rawScreen, rehydrationHandle: undefined };
    }

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

function bindingsFromScreen(
  routeBindings: readonly RehydrationRouteBinding[],
  rawScreen: ReturnType<typeof screenInferencePayload>,
  authorityReceipt: ReturnType<typeof screenInferencePayload>["receipt"],
): RehydrationAuthorizationBinding[] {
  return routeBindings.map((binding) => ({
    ...binding,
    sensitivity: rawScreen.classification.overallSensitivity,
    decisionVersions: authorityReceipt.decisionVersions.map((version) => ({
      ...version,
    })),
    dataClasses: [...rawScreen.receipt.classifiedDataClasses],
  }));
}

function normalizeRouteBindings(
  input: RehydrationRouteBinding | readonly RehydrationRouteBinding[] | undefined,
): RehydrationRouteBinding[] {
  if (!input) return [];
  const bindings = Array.isArray(input) ? [...input] : [input];
  const first = bindings[0];
  if (!first) return [];
  const actorKey = JSON.stringify(first.expectedActor);
  if (
    bindings.some((binding) =>
      binding.purpose !== first.purpose ||
      binding.surface !== first.surface ||
      JSON.stringify(binding.expectedActor) !== actorKey
    )
  ) {
    throw new ResponseRehydrationBindingError();
  }
  return bindings;
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
