/**
 * DPF2-REMOVABLE: non-acting-answer in-turn failover helpers.
 *
 * A `tool-action` turn that was handed real tools, invoked none, and closed
 * with a guidance-only / "unavailable" reply gets one bounded re-dispatch to a
 * different-adapter candidate. These helpers mirror rotateTerminalWriterProvider
 * (terminal-tool-policy.ts) and are consumed by the agentic loop. Delete at the
 * DPF2 cutover with the rest of the bridge (see
 * @/lib/routing/non-acting-bridge-config.ts).
 */

import { prisma } from "@dpf/db";
import type { RouteAndCallOptions, RoutedInferenceResult } from "@/lib/routed-inference";
import { NON_ACTING_BRIDGE_CONFIG } from "@/lib/routing/non-acting-bridge-config";

/** Resolve the canonical adapter string for a dispatch result (for the tally + log). */
export function resolveDispatchAdapter(result: RoutedInferenceResult): string {
  const adapter = result.routeDecision?.executionPlan?.executionAdapter;
  if (typeof adapter === "string" && adapter.trim()) return adapter.trim();
  if (adapter && typeof adapter === "object" && "kind" in adapter) {
    return String((adapter as { kind: unknown }).kind);
  }
  return "unknown";
}

/** The endpoint identifier for a dispatch result; falls back to provider:model. */
export function dispatchEndpointId(result: RoutedInferenceResult): string {
  return result.routeDecision?.selectedEndpoint ?? `${result.providerId}:${result.modelId}`;
}

/**
 * Deny the provider that returned a non-acting answer so the bounded re-dispatch
 * routes elsewhere. Mirrors rotateTerminalWriterProvider; additionally drops a
 * pinned model preference so routing is free to land on a different-adapter
 * candidate (NON_ACTING_BRIDGE_CONFIG.requireDifferentAdapterOnRetry) rather than
 * re-selecting the same model on another connection.
 */
export function denyNonActingProvider(options: RouteAndCallOptions, providerId: string): void {
  const denied = providerId.trim();
  if (!denied || denied === "unknown") return;
  options.deniedProviders = [...new Set([...(options.deniedProviders ?? []), denied])];
  if (options.preferredProviderId === denied) delete options.preferredProviderId;
  if (NON_ACTING_BRIDGE_CONFIG.requireDifferentAdapterOnRetry) {
    delete options.preferredModelId;
    delete options.preferredModelFamily;
  }
}

/** Longer substantive content wins when neither of two non-acting answers acted. */
export function pickBetterNonActingResult(
  a: RoutedInferenceResult | null,
  b: RoutedInferenceResult,
): RoutedInferenceResult {
  if (!a) return b;
  return (b.content ?? "").trim().length > (a.content ?? "").trim().length ? b : a;
}

/**
 * Record the in-turn failover on the replacement dispatch's RouteDecisionLog as
 * a fallbacksUsed entry (non-acting endpoint + retry marker + replacement
 * endpoint). Keyed by the replacement decision's traceId. Fire-and-forget — a
 * telemetry write must never break a live turn.
 */
export async function annotateNonActingFailover(
  replacement: RoutedInferenceResult,
  failedOver: { nonActingEndpoint: string; adapter: string },
): Promise<void> {
  const traceId = replacement.routeDecision?.traceId;
  if (!traceId) return;
  const record = {
    endpointId: failedOver.nonActingEndpoint,
    error:
      `${NON_ACTING_BRIDGE_CONFIG.nonActingProviderErrorCode}: ` +
      `re-dispatched off adapter ${failedOver.adapter} to ${dispatchEndpointId(replacement)}`,
    timestamp: new Date().toISOString(),
  };
  try {
    await prisma.routeDecisionLog.updateMany({
      where: { traceId },
      data: { fallbacksUsed: [record] as unknown as never },
    });
  } catch (err) {
    console.warn("[agentic-loop] failed to annotate non-acting failover on RouteDecisionLog:", err);
  }
}
