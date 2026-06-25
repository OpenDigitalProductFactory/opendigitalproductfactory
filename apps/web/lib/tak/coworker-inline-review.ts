// EP-GOLDEN-TRIANGLE — the executor for the inline coworker review pass.
//
// Runs ONE lightweight reviewer call over a coworker's draft reply when the
// posture calls for "review" (the high-effort rung). Kept out of the pure core
// (lib/golden-triangle/coworker-review.ts) because it touches the inference layer.
// Safety: fail-open (original draft on any error), single extra call, and it
// passes NO agentId — so the reviewer call neither re-resolves the author's
// posture nor recurses into another review.
import type { RouteSensitivity } from "@/lib/agent-sensitivity";
import type { ChatMessage } from "@/lib/ai-inference";
import {
  buildReviewerUserPrompt,
  interpretReviewVerdict,
  REVIEWER_SYSTEM_PROMPT,
  type ReviewVerdict,
} from "@/lib/golden-triangle/coworker-review";
import { routeAndCall } from "@/lib/inference/routed-inference";

export interface InlineReviewInput {
  /** The user's request the draft is answering (for the reviewer's context). */
  userRequest: string;
  /** The coworker's draft reply to review. */
  draft: string;
  sensitivity: RouteSensitivity;
}

export async function reviewCoworkerDraft(input: InlineReviewInput): Promise<ReviewVerdict> {
  const draft = input.draft;
  if (!draft || !draft.trim()) return { content: draft, revised: false };
  try {
    const messages: ChatMessage[] = [
      { role: "user", content: buildReviewerUserPrompt(input.userRequest, draft) },
    ];
    const result = await routeAndCall(messages, REVIEWER_SYSTEM_PROMPT, input.sensitivity, {
      taskType: "review",
      // Capable reviewer; deliberately NO agentId so this call does not re-resolve
      // the author coworker's posture and cannot recurse into another review.
      modelTier: "robust",
      routingActor: { kind: "system", id: "golden-triangle-coworker-review" },
    });
    return interpretReviewVerdict(draft, result.content);
  } catch (err) {
    console.warn("[golden-triangle] inline coworker review failed (fail-open):", err);
    return { content: draft, revised: false };
  }
}
