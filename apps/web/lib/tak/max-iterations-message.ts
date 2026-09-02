import type { DowngradeCause } from "@/lib/inference/downgrade-explanation";

/** The executed-tool shape this copy needs — count only, never names. */
type ExecutedTool = { name: string };

/**
 * Plain-English message for when the loop hits MAX_ITERATIONS without
 * producing a text-only response. Replaces the prior generic "I ran into
 * a limit while working on this. Try breaking your request into smaller
 * steps." which obscured the actual cause (usually: preferred provider
 * unavailable → fallback model overwhelmed by the tool surface). Respects
 * IDENTITY_BLOCK rule #5 — no provider/model/tool internals exposed.
 *
 * BI-F4D3B9E9(d): this branched on `downgraded`, which conflated "a dispatch
 * failed" with "nothing was eligible" — so it printed "My usual AI was
 * unavailable" directly beneath a banner that had just said "your configured
 * provider is active but wasn't eligible". One of the two was always wrong.
 * It now branches on the routed `downgradeReason` so both statements describe
 * the same cause, and it no longer tells an owner to connect a provider they
 * already have connected.
 */
export function buildMaxIterationsExhaustedMessage(params: {
  downgradeReason: "provider-unavailable" | "not-eligible" | null;
  executedTools: ExecutedTool[];
  /**
   * The cause that actually excluded the preferred route, from the same
   * `bindingCause` the banner above the message used. Optional so older callers
   * still compile; when absent the suggestion stays cause-neutral rather than
   * guessing (BI-FB184D69).
   */
  cause?: DowngradeCause | null;
}): string {
  const downgradeLead = params.downgradeReason === "provider-unavailable"
    ? "My usual AI was unavailable, so I worked through a backup that wasn't able to keep up. "
    : params.downgradeReason === "not-eligible"
      ? "My usual AI wasn't a fit for this particular request, so I worked through a backup that wasn't able to keep up. "
      : "";
  // Tool names are engineer-facing. They stay on the route and tool trace, where
  // an engineer already looks; in the owner's sentence they were noise dressed
  // as detail (BI-FB184D69).
  const workNote = params.executedTools.length > 0
    ? "I worked through several attempts but couldn't complete a final answer before hitting my safety limit."
    : "I couldn't complete a final answer before hitting my safety limit.";
  return `${downgradeLead}${workNote} ${exhaustedSuggestion(params)}`;
}

/**
 * What the owner should actually do about it.
 *
 * The old not-eligible arm always said "a shorter request usually routes back to
 * the stronger model". Under a residency or clearance exclusion that is simply
 * false — length is not the axis — and the owner who tested it directly spent
 * six more minutes to reach the identical failure. Advice that cannot work costs
 * real time every time it is followed (BI-FB184D69).
 */
function exhaustedSuggestion(params: {
  downgradeReason: "provider-unavailable" | "not-eligible" | null;
  cause?: DowngradeCause | null;
}): string {
  if (params.downgradeReason === "provider-unavailable") {
    return "Reconnecting or restoring that provider at Platform > AI > Providers unlocks the work I'm built for. Otherwise, try a narrower question.";
  }
  if (params.downgradeReason !== "not-eligible") {
    return "Try the same question again, or break it into a smaller piece.";
  }
  switch (params.cause) {
    case "residency":
    case "clearance":
      // Nothing the owner can retype changes a data-boundary decision.
      return "This is a data-handling rule, not a size limit — rewording or shortening won't change it. Asking the same thing somewhere that doesn't carry confidential data will route to the stronger model.";
    case "rate-limit":
      return "The stronger model was at its rate limit; the same question in a few minutes should reach it.";
    case "context-window":
      return "This request was longer than the stronger model's context window, so a shorter one will route back to it.";
    case "capability":
    case "model-class":
      return "The stronger model isn't offered for this kind of work. The note above says what ruled it out.";
    default:
      return "The note above says what ruled it out.";
  }
}
