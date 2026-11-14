// apps/web/lib/routing/model-capacity-reference.ts
//
// Researched token capacity for models served through the Codex transport
// (the `chatgpt` and `codex` subscription providers), so a discovered model
// carries the output and context capacity that activity admission requires.
//
// The defect this closes (BI-F0ECD797): the authenticated Codex `model/list`
// catalog publishes slugs, modalities and reasoning efforts but no token
// limits, so every Codex-served ModelProfile had maxOutputTokens and
// maxContextTokens NULL. Activity admission (execution-plan.ts
// activityBudgetExclusion) correctly refuses an endpoint whose capacity is
// unknown, so every semantic review excluded all ChatGPT endpoints and pinned
// to local inference.
//
// The rule matches model-pricing-reference.ts: a model takes its capacity from
// this reference or stays UNKNOWN. It is never guessed or copied from a
// sibling. An absent row is a signal to research and add one.
//
// Two sources, one per limit, because the transport and the model differ:
//   - Output: the model's own maximum, from OpenAI's per-model documentation
//     (https://developers.openai.com/api/docs/models/<slug>), retrieved
//     2026-11-13. Every row below lists "128,000 max output tokens".
//   - Context: the Codex transport's window, which is smaller than the API's
//     1,050,000-token window. Taken from the `context_window` that Codex CLI
//     0.167.2 ships for each slug in its bundled model metadata (the same
//     values its /backend-api/codex/models catalog serves). Using the API
//     window here would admit requests the subscription transport cannot hold.

export type ReferenceCapacity = {
  maxOutputTokens: number;
  maxContextTokens: number;
};

const CODEX_TRANSPORT_CAPACITY: Readonly<Record<string, ReferenceCapacity>> = {
  "gpt-6.1-sol": { maxOutputTokens: 128_000, maxContextTokens: 272_000 },
  "gpt-6.1-terra": { maxOutputTokens: 128_000, maxContextTokens: 500_000 },
  "gpt-6-sol": { maxOutputTokens: 128_000, maxContextTokens: 272_000 },
  "gpt-6-luna": { maxOutputTokens: 128_000, maxContextTokens: 272_000 },
  "gpt-6-astra": { maxOutputTokens: 128_000, maxContextTokens: 272_000 },
  "gpt-5.6-sol": { maxOutputTokens: 128_000, maxContextTokens: 272_000 },
  "gpt-5.6-terra": { maxOutputTokens: 128_000, maxContextTokens: 272_000 },
  "gpt-5.6-luna": { maxOutputTokens: 128_000, maxContextTokens: 272_000 },
};

/** Capacity of a slug served by the Codex transport, or null when unresearched. */
export function referenceCodexTransportCapacity(modelId: string | null | undefined): ReferenceCapacity | null {
  if (!modelId || !Object.hasOwn(CODEX_TRANSPORT_CAPACITY, modelId)) return null;
  return { ...CODEX_TRANSPORT_CAPACITY[modelId]! };
}
