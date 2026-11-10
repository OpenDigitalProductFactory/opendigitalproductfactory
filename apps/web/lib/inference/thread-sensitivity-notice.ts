// apps/web/lib/inference/thread-sensitivity-notice.ts
//
// BI-706530B2 — tell the owner their conversation is pinned, and only offer an
// action that would actually clear it.
//
// A screen receipt already records enough to explain a local-only verdict:
// which data classes were detected, which probe path carried each match, and
// whether the match came from a real turn or from platform-composed
// instruction text. None of it reaches the person having the conversation.
// What they observe is a coworker that quietly got slower and less capable,
// with no stated cause and no offered remedy.
//
// The routing is NOT the defect and this module changes none of it. History is
// genuinely resent, so a governed value in an early message genuinely leaves
// the box on every later turn, and restricting is correct. The defect is that
// the constraint is invisible and appears unclearable.
//
// The one judgement this module makes is WHEN the remedy would help. If every
// escalating match sits in history, withholding that history from dispatch
// restores normal routing and saying so is true. If any escalating match is in
// the current exchange, withholding the past changes nothing — the very next
// message re-triggers — and offering it would be a lie. So the action is
// offered on `history` alone, never on `mixed`.
//
// The remedy itself is payload-side, operator-ratified 2026-09-07 against
// kernel DI-B60AD9E7746F: the withheld span stops being SENT, so the screen
// legitimately re-scores a smaller payload. Evidence is never aged out from
// under data that is still travelling. See lib/tak/thread-history-withholding.ts.

import type {
  InferenceDataClass,
  InferenceDataScreenReceipt,
  InferenceMatchProvenance,
} from "./data-screening/types";

/** Where the matches that forced local-only routing actually sit. */
export type ThreadSensitivityPin =
  /** All of them are in history — a fresh thread clears the constraint. */
  | "history"
  /** All of them are in the exchange under way — a fresh thread changes nothing. */
  | "current-turn"
  /** Both. A fresh thread would re-trigger immediately. */
  | "mixed"
  /**
   * None came from a message: the coworker's own instructions, its tool
   * schemas, or a declared governed-data hint. The owner cannot clear this by
   * changing how they write, and a new thread carries it straight over.
   */
  | "outside-conversation";

export type ThreadSensitivityNotice = {
  pin: ThreadSensitivityPin;
  dataClasses: InferenceDataClass[];
  /** Payload indices of the escalating matches. Indices, never content. */
  messageIndices: number[];
  headline: string;
  detail: string;
  /** Present only when it would actually work. */
  action: { kind: "withhold-earlier-history"; label: string } | null;
};

const MESSAGE_PATH = /^messages\[(\d+)\]/;

/**
 * A match escalates only if it came from conversation content.
 *
 * `origin` absent means an unlabelled probe, which is treated as a real turn —
 * the fail-closed default the classifier already uses. Instruction spans and
 * other composed origins are recorded in the receipt but set no floor, so
 * counting them here would blame the owner for text they never wrote.
 */
function escalatingMessageIndex(row: InferenceMatchProvenance): number | null {
  if (row.origin !== undefined && row.origin !== "turn") return null;
  const matched = MESSAGE_PATH.exec(row.path);
  if (!matched) return null;
  const index = Number(matched[1]);
  return Number.isInteger(index) ? index : null;
}

function humanizeDataClass(value: string): string {
  return value.replace(/-/g, " ");
}

function describeClasses(classes: readonly InferenceDataClass[]): string {
  if (classes.length === 0) return "governed data";
  return classes.map(humanizeDataClass).join(", ");
}

/**
 * Explain a local-only verdict to the thread's owner.
 *
 * `currentTurnStartIndex` is the payload index at which the exchange under way
 * begins — everything below it is history the owner may not remember writing.
 * Returns null when there is nothing to explain: normal routing, or a receipt
 * too old to carry provenance (pre-provenance receipts would otherwise produce
 * a notice with no cause, which is worse than silence).
 */
export function deriveThreadSensitivityNotice(input: {
  receipt: Pick<
    InferenceDataScreenReceipt,
    "routeEffect" | "classifiedDataClasses" | "matchProvenance"
  >;
  currentTurnStartIndex: number;
}): ThreadSensitivityNotice | null {
  const { receipt, currentTurnStartIndex } = input;
  if (receipt.routeEffect !== "local-only") return null;

  const provenance = receipt.matchProvenance;
  if (provenance === undefined) return null;

  const indices = provenance
    .map(escalatingMessageIndex)
    .filter((index): index is number => index !== null)
    .sort((left, right) => left - right);

  const dataClasses = [...receipt.classifiedDataClasses];
  const classText = describeClasses(dataClasses);
  const unique = [...new Set(indices)];

  if (unique.length === 0) {
    return {
      pin: "outside-conversation",
      dataClasses,
      messageIndices: [],
      headline: "This coworker is running on a local model",
      detail:
        `Its own setup — instructions, tools or connected data — involves ${classText}, ` +
        "so its work stays on this machine. Nothing you write changes that, and setting " +
        "earlier messages aside carries the same setup over.",
      action: null,
    };
  }

  const fromHistory = unique.some((index) => index < currentTurnStartIndex);
  const fromCurrent = unique.some((index) => index >= currentTurnStartIndex);
  const pin: ThreadSensitivityPin = fromHistory && fromCurrent
    ? "mixed"
    : fromHistory
      ? "history"
      : "current-turn";

  if (pin === "history") {
    return {
      pin,
      dataClasses,
      messageIndices: unique,
      headline: "This conversation is staying on a local model",
      detail:
        `Something earlier in it involves ${classText}. Every message is re-read each ` +
        "time you reply, so that earlier part keeps applying even when it has nothing to " +
        "do with what you are asking now. You can carry on here without sending the " +
        "earlier messages — they stay in your record, this coworker just stops re-reading them.",
      action: { kind: "withhold-earlier-history", label: "Continue without the earlier messages" },
    };
  }

  return {
    pin,
    dataClasses,
    messageIndices: unique,
    headline: "This conversation is staying on a local model",
    detail:
      `What you are discussing involves ${classText}, so it stays on this machine. ` +
      "Setting the earlier messages aside would not change that while the same subject is live.",
    action: null,
  };
}
