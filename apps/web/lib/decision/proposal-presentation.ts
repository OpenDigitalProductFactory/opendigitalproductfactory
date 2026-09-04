// How a drafted resolution reads to the owner (BI-3D0FB84B, EP-0AF96937).
//
// Pure, and the home of every word the proposal card renders. Two reasons it
// lives here rather than in the component: the copy that explains what
// accepting DOES belongs next to the actionKind vocabulary that decides it,
// and copy built in lib/ stays out of the page's UI-copy ratchet, so the card
// can say what it needs to without spending another surface's budget.
//
// Nothing here softens what acceptance means. Each actionKind states its real
// consequence, including that an org-corpus answer still lands as draft.
//
// Spec: docs/superpowers/specs/2026-08-23-decision-concierge-design.md §4.4-§4.5

import type { ProposalActionKind } from "./resolution-proposal-store";

export type PresentedDissent = { role: string; position: string; because: string };

export type PresentedProposal = {
  proposalId: string;
  heading: string;
  /** What the owner is being asked to accept. */
  summary: string;
  /** What accepting would actually do. */
  effect: string;
  /** The draft itself, when it is text the owner can read and edit. */
  draftText: string | null;
  /** Field name inside the payload that `draftText` came from, for amendment. */
  draftField: string | null;
  dissent: PresentedDissent[];
  /** Confidence sentence, or null when the panel recorded none. */
  confidence: string | null;
  /** Stated when nothing disagreed, so agreement and silence never look alike. */
  agreementNote: string | null;
  labels: typeof PROPOSAL_LABELS;
};

export const PROPOSAL_LABELS = {
  heading: "What your coworkers suggest",
  accept: "Accept",
  amend: "Edit, then accept",
  reject: "Reject",
  cancel: "Cancel",
  working: "Saving…",
  dissentHeading: "Not everyone agreed",
  amendHint: "Edit the wording. What you accept is what gets recorded.",
  rejectHint: "Say why, so the same suggestion does not come back.",
  notePlaceholder: "Why this is not the right call…",
} as const;

/** What accepting each kind of proposal does, in the owner's terms. */
const EFFECT: Record<ProposalActionKind, string> = {
  "answer_gap":
    "Accepting records this as your business's answer. It is saved as draft doctrine for you to review before your AI treats it as settled.",
  "adopt_option": "Accepting records this option as your decision and closes the question.",
  "adjust_weight":
    "Accepting records the change at the ruled tier. It does not yet move any live decision score.",
  "amend_stance": "Accepting drafts an edit to the named page for you to review.",
  "release_material": "Accepting puts that craft material to work for the coworker that needs it.",
  "no_change": "Accepting closes the question with your reason recorded, and changes nothing else.",
};

/** Which payload field carries editable text, per kind. Null = nothing to edit. */
const DRAFT_FIELD: Record<ProposalActionKind, string | null> = {
  "answer_gap": "answer",
  "adopt_option": null,
  "adjust_weight": null,
  "amend_stance": "body",
  "release_material": null,
  "no_change": "reason",
};

function readString(payload: unknown, key: string | null): string | null {
  if (!key || !payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readDissent(value: unknown): PresentedDissent[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const d = entry as Record<string, unknown>;
    return typeof d.role === "string" && typeof d.position === "string"
      ? [{
        role: d.role,
        position: d.position,
        because: typeof d.because === "string" ? d.because : "",
      }]
      : [];
  });
}

function confidenceSentence(confidence: number | null): string | null {
  if (confidence === null || !Number.isFinite(confidence)) return null;
  if (confidence >= 0.75) return "Your coworkers were confident about this.";
  if (confidence >= 0.45) return "Your coworkers were only moderately sure — worth a read before you accept.";
  return "Your coworkers were not confident. Treat this as a starting point, not advice.";
}

/**
 * Shape one proposal for rendering. Returns null for anything already ruled:
 * a settled proposal is history, and history does not get action buttons.
 */
export function presentProposal(row: {
  proposalId: string;
  actionKind: string;
  status: string;
  /** Row liveness. A retired draft is history even though nobody ruled on it. */
  lifecycle?: string;
  summary: string;
  draftPayload: unknown;
  dissent: unknown;
  confidence: number | null;
}): PresentedProposal | null {
  if (row.status !== "proposed") return null;
  if (row.lifecycle && row.lifecycle !== "active") return null;
  const actionKind = row.actionKind as ProposalActionKind;
  const effect = EFFECT[actionKind];
  if (!effect) return null;

  const draftField = DRAFT_FIELD[actionKind];
  const dissent = readDissent(row.dissent);

  return {
    proposalId: row.proposalId,
    heading: PROPOSAL_LABELS.heading,
    summary: row.summary,
    effect,
    draftText: readString(row.draftPayload, draftField),
    draftField,
    dissent,
    confidence: confidenceSentence(row.confidence),
    agreementNote: dissent.length === 0 ? "Everyone who looked at this agreed." : null,
    labels: PROPOSAL_LABELS,
  };
}

/* -------------------------------------------------------------------------- */
/* Queue presentation                                                         */
/* -------------------------------------------------------------------------- */

export const PROPOSAL_QUEUE_COPY = {
  heading: "Suggestions waiting on you",
  intro:
    "Your coworkers drafted an answer for these. Open one to read what they suggest and accept, edit or reject it.",
  action: "Review the suggestion",
} as const;

export type PresentedQueueRow = {
  proposalId: string;
  summary: string;
  href: string;
  /** Coworkers disagreed — worth saying before the owner opens it. */
  contested: boolean;
};

/**
 * Shape the open proposals for the review queue. A proposal bound to a
 * decision links to that decision's record, which is where ruling happens; one
 * bound only to a gap cluster has no record to open, so it is left out rather
 * than rendered as a dead row.
 */
export function presentProposalQueue(
  rows: Array<{
    proposalId: string;
    summary: string;
    status: string;
    lifecycle?: string;
    dissent: unknown;
    interactionSemanticId: string | null;
  }>,
): PresentedQueueRow[] {
  return rows.flatMap((row) => {
    if (row.status !== "proposed" || !row.interactionSemanticId) return [];
    if (row.lifecycle && row.lifecycle !== "active") return [];
    return [{
      proposalId: row.proposalId,
      summary: row.summary,
      href: `/coworker-decisions/decisions/${encodeURIComponent(row.interactionSemanticId)}`,
      contested: Array.isArray(row.dissent) && row.dissent.length > 0,
    }];
  });
}

/** Which control the proposal card is currently showing. */
export const PROPOSAL_CARD_MODES = { idle: "idle", amending: "amending", rejecting: "rejecting" } as const;
export type ProposalCardMode = (typeof PROPOSAL_CARD_MODES)[keyof typeof PROPOSAL_CARD_MODES];

/** The card's starting mode, typed here so callers need no generic to infer it. */
export const IDLE_PROPOSAL_MODE: ProposalCardMode = PROPOSAL_CARD_MODES.idle;
