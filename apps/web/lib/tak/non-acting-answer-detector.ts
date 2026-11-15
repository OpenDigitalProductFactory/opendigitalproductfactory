/**
 * DPF2-REMOVABLE BRIDGE MODULE.
 *
 * Detects a "non-acting" provider turn: a `tool-action` task that was handed
 * real tools, invoked none of them, and closed with a reply that either falsely
 * claims a delivered tool was unavailable (clause 2.6 path) or reads as
 * guidance-only / unfinished. Part of the disposable pre-DPF2 routing bridge —
 * delete together with the consumers listed in
 * apps/web/lib/routing/non-acting-bridge-config.ts when DPF2's native
 * acting-contract enforcement lands.
 */

import { NON_ACTING_BRIDGE_CONFIG } from "@/lib/routing/non-acting-bridge-config";
import { detectToolRefusedDespiteAvailability } from "@/lib/tak/tool-refused-recovery";

export interface DetectNonActingAnswerArgs {
  /** Task type for the turn (only `eligibleTaskTypes` are considered). */
  taskType: string;
  /** How many tools were delivered/attached to the turn. */
  attachedToolCount: number;
  /** How many tool calls the turn actually produced. */
  toolCallCount: number;
  /** The provider's final reply text for the turn. */
  replyText: string;
}

/**
 * Returns true only when the turn is a non-acting answer:
 *  - taskType is one of NON_ACTING_BRIDGE_CONFIG.eligibleTaskTypes, AND
 *  - tools were attached (attachedToolCount > 0), AND
 *  - no tool call was made (toolCallCount === 0), AND
 *  - the reply either falsely refuses a delivered tool
 *    (detectToolRefusedDespiteAvailability) OR contains any configured
 *    unavailable/unfinished phrase (case-insensitive).
 */
export function detectNonActingAnswer(args: DetectNonActingAnswerArgs): boolean {
  const { taskType, attachedToolCount, toolCallCount, replyText } = args;

  if (!NON_ACTING_BRIDGE_CONFIG.eligibleTaskTypes.includes(taskType as never)) {
    return false;
  }
  if (attachedToolCount <= 0) return false;
  if (toolCallCount !== 0) return false;

  const text = replyText ?? "";

  // The detector receives only a tool count, not the delivered tool names, so
  // pass an empty list: this still catches the generic "currently []" / pending
  // refusals, and the configured phrase list covers the named-tool cases.
  if (detectToolRefusedDespiteAvailability(text, []) !== null) {
    return true;
  }

  const haystack = text.toLowerCase();
  return NON_ACTING_BRIDGE_CONFIG.unavailableOrUnfinishedPhrases.some((phrase) =>
    haystack.includes(phrase.toLowerCase()),
  );
}
