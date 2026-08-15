// BI-C0F180E8 (EP-B9DD37C7) — honest local-degradation.
//
// When paid providers are unavailable a coworker turn can fall to the bundled
// local model. If that model answers WITHOUT using any tools, the coworker could
// not inspect live data this turn — yet the reply still reads as authoritative.
// The reported failure: a backlog question answered confidently and wrongly on
// local, with no signal that the coworker never actually looked. See the epic
// and apps/web/lib/routing/fallback.ts (LOCAL_FALLBACK_MAX_TOOLS) for why local
// runs toolless on a large tool surface.
//
// The fix PREPENDS an honest caveat rather than discarding the answer — a
// downgraded turn can still be a fine no-tool reply, and discarding good answers
// is the failure the routing-resilience work (agentic-loop.ts:1762) exists to
// avoid. We only caveat the narrow untrustworthy case: the *local* model, with
// *zero* tool calls, on a substantive answer that does not already own up to
// running degraded.

/** Canonical local provider id (matches lib/routing/fallback.ts). */
const LOCAL_PROVIDER_ID = "local";

/** Plain, non-alarming, actionable. Rendered as markdown (italic) in the bubble. */
export const LOCAL_UNVERIFIED_CAVEAT =
  "_I answered this on the bundled local model and couldn't use my tools this turn, " +
  "so I couldn't check live data — treat the below as unverified, and send the message " +
  "again in a moment for a tool-backed answer._";

// If the answer already names the degraded/local state (an honest diagnostic the
// loop itself produced), a second caveat is noise. Keep this in sync with the
// degradation copy in agentic-loop.ts / routed-inference.ts.
const ALREADY_FLAGS_DEGRADATION = /bundled local model|paid AI providers|briefly unavailable|\blocal model\b/i;

export function shouldCaveatLocalDegradation(opts: {
  providerId: string;
  executedToolCount: number;
  authoritativeSurfaceEvidence?: boolean;
  content: string;
}): boolean {
  const { providerId, executedToolCount, authoritativeSurfaceEvidence, content } = opts;
  if (providerId !== LOCAL_PROVIDER_ID) return false; // a strong paid backup is trustworthy
  if (executedToolCount > 0) return false; // it actually used tools — not a blind answer
  if (authoritativeSurfaceEvidence) return false; // current authorization-filtered UX state was injected
  if (!content.trim()) return false; // nothing to caveat
  if (ALREADY_FLAGS_DEGRADATION.test(content)) return false; // already honest
  return true;
}

/**
 * Prepend the honest local-degradation caveat when the turn ran on the bundled
 * local model with no tool calls. Returns `content` unchanged otherwise.
 */
export function applyLocalDegradationCaveat(
  content: string,
  opts: { providerId: string; executedToolCount: number; authoritativeSurfaceEvidence?: boolean },
): string {
  return shouldCaveatLocalDegradation({ ...opts, content })
    ? `${LOCAL_UNVERIFIED_CAVEAT}\n\n${content}`
    : content;
}
