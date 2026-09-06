// apps/web/lib/inference/routed-token-usage.ts
//
// Token-usage persistence for routed inference calls, split out of
// routed-inference.ts (module-size ceiling) when the contextKey fallback grew
// a build form (BI-B3AB7FC9).

import { logTokenUsage } from "@/lib/ai-inference";
import type { RouteAndCallOptions } from "./routed-inference-options";

// ─── Phase J: routed-call token usage persistence ──────────────────────────
//
// Every routed inference call must produce a `TokenUsage` row regardless of
// which adapter served it. Before this fix, only the direct HTTP path
// (`callProvider` in `ai-inference.ts`) wrote metering — the CLI subprocess
// adapters (claude-cli, codex-cli) silently bypassed it. The result was a
// $0 cost tally for ~100% of subscription-served traffic on a typical install.
//
// This wrapper is the *convenience* enforcement; the durable enforcement is
// the OutcomeEvent-bus detector "outcome event without metering row" listed
// in the routing-architecture spec §10.2. That bus check makes new dispatch
// paths (future adapters) loud about forgetting to meter; this wrapper makes
// it easy to satisfy by default.
//
// Errors are best-effort for completed synchronous calls. An accepted async
// dispatch can require settlement before it is exposed to the caller because
// that row is the dispatch audit, not eventual completion metering.
/**
 * TokenUsage.contextKey for a routed call: the thread when there is one, else
 * the build, else the task type. "routed-call" is the last resort and means
 * the caller said nothing about itself (BI-B3AB7FC9).
 */
export function routedContextKey(options: RouteAndCallOptions | undefined): string {
  if (options?.threadId) return options.threadId;
  if (options?.buildId) return `build:${options.buildId}`;
  return options?.taskType ?? "routed-call";
}

export async function persistRoutedTokenUsage(input: {
  traceId?: string | null;
  agentId: string;
  providerId: string;
  contextKey: string;
  inputTokens: number;
  outputTokens: number;
  // BI-105E8A1E: carry the adapter's measured latency so logTokenUsage's
  // `compute` cost model can fire — it is the cost signal for a fully-local
  // install, and was previously dropped here, leaving inferenceMs ~99% empty.
  inferenceMs?: number;
  /** Record an accepted provider dispatch even when completion usage is not yet known. */
  recordZeroUsage?: boolean;
  /** Fail the caller when this dispatch audit cannot be persisted. */
  requirePersistence?: boolean;
}): Promise<void> {
  // Skip rows with zero tokens both ways unless this is an accepted background
  // start whose completion usage is not available yet. Other zero/zero results
  // usually mean the adapter returned an error or stub, so recording them would
  // be misleading.
  if (input.inputTokens === 0 && input.outputTokens === 0 && !input.recordZeroUsage) {
    return;
  }
  try {
    const {
      recordZeroUsage: _recordZeroUsage,
      requirePersistence: _requirePersistence,
      ...usage
    } = input;
    await logTokenUsage(usage);
  } catch (err) {
    console.error(
      `[routed-inference] token usage persistence failed: provider=${input.providerId} ` +
      `agent=${input.agentId} in=${input.inputTokens} out=${input.outputTokens}`,
      err,
    );
    if (input.requirePersistence) {
      throw err;
    }
  }
}
