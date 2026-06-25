// EP-GOLDEN-TRIANGLE — the executor for the inline coworker deliberation pass.
//
// Runs ONE extra model call over a coworker's draft reply when the posture calls
// for "review" (critique → improve) or "debate" (steelman for/against → synthesize)
// — the high-effort rungs of the rigor ladder. Kept out of the pure core
// (lib/golden-triangle/coworker-review.ts) because it touches the inference layer.
// Safety: fail-open (original draft on any error), a single bounded extra call, and
// it passes NO agentId — so the call neither re-resolves the author's posture nor
// recurses into another review. (The full multi-agent deliberation engine —
// minutes-long, build-artifact-coupled — stays the build-phase mechanism; this is
// the synchronous, output-revising leverage for coworker turns.)
import type { RouteSensitivity } from "@/lib/agent-sensitivity";
import type { ChatMessage } from "@/lib/ai-inference";
import {
  buildDeliberationPrompt,
  interpretReviewVerdict,
  type ReviewVerdict,
} from "@/lib/golden-triangle/coworker-review";
import { routeAndCall } from "@/lib/inference/routed-inference";

export interface InlineReviewInput {
  /** The user's request the draft is answering (for the reviewer/debater context). */
  userRequest: string;
  /** The coworker's draft reply to deliberate over. */
  draft: string;
  sensitivity: RouteSensitivity;
  /** Which pattern the posture calls for. Defaults to "review". */
  pattern?: "review" | "debate";
}

export async function reviewCoworkerDraft(input: InlineReviewInput): Promise<ReviewVerdict> {
  const draft = input.draft;
  if (!draft || !draft.trim()) return { content: draft, revised: false };
  const pattern = input.pattern ?? "review";
  try {
    const { system, user } = buildDeliberationPrompt(pattern, input.userRequest, draft);
    const messages: ChatMessage[] = [{ role: "user", content: user }];
    const result = await routeAndCall(messages, system, input.sensitivity, {
      taskType: pattern,
      // Debate is the top rung — give it max effort; review uses high. Capable
      // model either way; deliberately NO agentId so this call does not re-resolve
      // the author coworker's posture and cannot recurse into another deliberation.
      modelTier: "robust",
      effort: pattern === "debate" ? "max" : "high",
      routingActor: { kind: "system", id: `golden-triangle-coworker-${pattern}` },
    });
    return interpretReviewVerdict(draft, result.content);
  } catch (err) {
    console.warn(`[golden-triangle] inline coworker ${pattern} failed (fail-open):`, err);
    return { content: draft, revised: false };
  }
}
