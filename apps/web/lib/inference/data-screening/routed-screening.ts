import type { ChatMessage } from "@/lib/inference/ai-inference";
import type { ActivityContract } from "@/lib/routing/activity-contract";
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
};

export function createRoutedInferenceScreen(input: RoutedScreenInput) {
  const screenInput = { ...input } satisfies ScreenInferencePayloadInput;
  return {
    screenInput,
    screen: screenInferencePayload(screenInput),
  };
}

export function rescreenRoutedInferenceWithoutTools(
  input: ScreenInferencePayloadInput,
) {
  const screenInput = {
    ...input,
    tools: undefined,
  } satisfies ScreenInferencePayloadInput;
  return {
    screenInput,
    receipt: screenInferencePayload(screenInput).receipt,
  };
}
