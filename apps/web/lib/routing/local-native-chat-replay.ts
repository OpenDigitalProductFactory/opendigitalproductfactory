import type { AdapterRequest } from "./adapter-types";
import { formatMessageForOpenAI } from "./provider-message-format";
import { createLocalContinuationBinding, isLocalNativeContinuationActive,
  readLocalNativeContinuation } from "./local-native-continuation";

/** Ephemeral wire payload only. Never return these messages as chat history. */
export async function prepareLocalNativeChatReplay(request: AdapterRequest, apiEndpoint: string) {
  const { providerId, modelId, provider, plan, systemPrompt, tools, messages } = request;
  if (providerId !== "local" || tools?.length || !isLocalNativeContinuationActive()) return undefined;
  const root = provider.baseUrl.replace(/\/(engines\/)?v1\/?$/, "");
  const runtime = await request.readLocalThinkingBudgetEvidence?.(root, modelId, request.fetchImpl)
    .catch(() => undefined);
  const binding = runtime ? createLocalContinuationBinding({
    providerId, modelId, apiEndpoint, providerConnectionId: plan.providerConnectionId,
    providerConnectionVersion: plan.providerConnectionVersion, runtime, systemPrompt, tools,
  }) : undefined;
  let replayed = false;
  const wireMessages = [
    { role: "system", content: systemPrompt },
    ...messages.map(message => {
      const formatted = formatMessageForOpenAI(message);
      const native = readLocalNativeContinuation(message, binding);
      if (native === undefined) return formatted;
      replayed = true;
      return { ...formatted, reasoning_content: native };
    }),
  ];
  return { binding, messages: wireMessages, replayed };
}
