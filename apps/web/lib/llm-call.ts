// apps/web/lib/llm-call.ts
//
// Thin LLM call helper for lightweight, self-contained utility prompts
// that need a system prompt + user message → text response.
//
// Uses routeAndCall from the inference layer with internal sensitivity
// and a minimize_cost budget class — suitable for style rewriting,
// summarization, and similar non-critical utility tasks.

export interface LLMCallInput {
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
}

export interface LLMCallResult {
  text: string;
}

export async function callLLM(input: LLMCallInput): Promise<LLMCallResult> {
  const { routeAndCall } = await import("@/lib/inference/routed-inference");

  const result = await routeAndCall(
    [{ role: "user", content: input.userMessage }],
    input.systemPrompt,
    "internal",
    {
      taskType: "utility_summarize",
      budgetClass: "minimize_cost",
      persistDecision: false,
    },
  );

  return { text: result.content };
}
