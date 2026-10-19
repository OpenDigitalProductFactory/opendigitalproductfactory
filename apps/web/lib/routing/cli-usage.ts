// apps/web/lib/routing/cli-usage.ts
//
// Usage as the Claude CLI reports it, and its adapter-shaped projection.
//
// `input_tokens` is Anthropic's UNCACHED input only. On a cached prefix it is a
// handful of tokens while the prompt the model actually read sits in
// `cache_read_input_tokens` and `cache_creation_input_tokens`. The CLI adapter
// used to type usage as input/output and drop both, which is why anthropic-sub
// reported ~17 input tokens per run on the live install and the per-thread cost
// ledger could not read its dominant provider (BI-CCF1ACBB).
//
// Kept out of cli-adapter.ts so that module stays under the size ceiling.

export type CliUsagePayload = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

/** Adapter-shaped usage: cache fields present only when the CLI reported > 0. */
export type CliParsedUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
};

export function toCliParsedUsage(usage: CliUsagePayload | undefined): CliParsedUsage {
  const parsed: CliParsedUsage = {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
  };
  const created = usage?.cache_creation_input_tokens ?? 0;
  const read = usage?.cache_read_input_tokens ?? 0;
  if (created > 0) parsed.cacheCreationInputTokens = created;
  if (read > 0) parsed.cacheReadInputTokens = read;
  return parsed;
}
