import { previewRoute, type RouteAndCallOptions } from "@/lib/routed-inference";
import type { ChatMessage } from "@/lib/ai-inference";
import type { RouteSensitivity } from "@/lib/agent-sensitivity";
import { rotateTerminalWriterProvider, summarizeTerminalToolProgress, type TerminalToolPolicy, type TerminalToolRecord } from "./terminal-tool-policy";

/** A retry may avoid a noncompliant provider only if a policy-eligible alternative exists. */
export async function rotateTerminalWriterRoute(input: {
  policy: TerminalToolPolicy;
  records: readonly TerminalToolRecord[];
  options: RouteAndCallOptions;
  providerId: string;
  messages: ChatMessage[];
  systemPrompt: string;
  sensitivity: RouteSensitivity;
}): Promise<void> {
  const progress = summarizeTerminalToolProgress(input.policy, input.records);
  if (!progress.evidenceAvailable || progress.writerAttempted) return;
  const candidate = { ...input.options };
  rotateTerminalWriterProvider(candidate, input.providerId);
  if (candidate.deniedProviders === input.options.deniedProviders) return;
  try {
    const preview = await previewRoute(input.messages, input.sensitivity, {
      ...candidate, screeningSystemPrompt: input.systemPrompt, persistDecision: false,
    });
    if (!preview.decision.selectedEndpoint) return;
  } catch {
    // Keep all existing fences and the single bounded nudge. The actual route
    // revalidates policy; a failed preview never grants a new provider access.
    return;
  }
  input.options.deniedProviders = candidate.deniedProviders;
  input.options.preferredProviderId = candidate.preferredProviderId;
}
