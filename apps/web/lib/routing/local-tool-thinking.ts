// Local tool turns must not open a thinking trace.
//
// Qwen3-class models start the assistant turn inside <think> unless the
// request says otherwise. On the bundled 27B that trace uses most of the
// 4096-token answer budget at about 16 tokens/s, so a proactive tool turn
// stays busy for minutes and often never emits the tool call. Tool-selection
// accuracy was the same with thinking disabled (Qwen3.8 tiering plan,
// 2026-08-16). Turns with no tools keep the model's default.

export function localToolThinkingKwargs(
  providerId: string,
  toolCount: number,
): { enable_thinking: false } | undefined {
  if (providerId !== "local" || toolCount <= 0) return undefined;
  return { enable_thinking: false };
}
