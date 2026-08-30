// apps/web/lib/build/plan-generation-retry.ts
//
// BI-7AD0759A — which endpoint should a plan-generation retry ask?
//
// Plan generation gets two attempts. Both used to go to whatever routing picked
// first, so an endpoint that returned unparseable JSON was asked the same
// question again — and returned unparseable JSON again. That is not a retry,
// it is a repetition with a different system prompt.
//
// Live repro FB-62D7C0EC on the Pet Rescue install: both attempts drew the
// local model, both truncated mid-array, the revision failed, and the build was
// lost with a plan review that had named five critical issues — while a capable
// endpoint sat unused.
//
// Pure module — no routing, no I/O — so the policy is testable on its own.

/**
 * Record an endpoint that failed to return parseable output.
 *
 * Returns a new list; never mutates. Ignores empty ids and duplicates so a
 * caller cannot accidentally deny the same endpoint twice or deny "".
 */
export function denyAfterUnparseable(
  denied: readonly string[],
  providerId: string | null | undefined,
): string[] {
  const id = (providerId ?? "").trim();
  if (id.length === 0 || denied.includes(id)) return [...denied];
  return [...denied, id];
}

/**
 * The routing denial to send with the next attempt.
 *
 * Returns undefined when nothing has failed yet, so the first attempt carries
 * no denial at all and routing is free to pick its preferred endpoint.
 *
 * Denials are advisory to routing, not a hard refusal: the platform must stay
 * runnable on whatever hardware it has (BI-3B3F477B). Asking routing to prefer
 * a different endpoint is the goal; refusing to run is never the goal.
 */
export function denialForNextAttempt(denied: readonly string[]): string[] | undefined {
  return denied.length > 0 ? [...denied] : undefined;
}
