// The contract a governance-triage panel must meet before its verdict becomes
// a proposal an owner can accept (BI-19B350FD, EP-0AF96937).
//
// This is the narrow gate between "a model produced some text" and "the owner
// is shown a recommendation with an Accept button". Everything it refuses stays
// refused: a verdict missing its action, its draft, its consequences or its
// dissent record does NOT become a proposal, and the decision record falls back
// to exactly what it showed before the panel ran.
//
// Why the strictness is the point. A drafted resolution is the most persuasive
// thing this platform puts in front of an owner — it arrives pre-written, so
// the cost of accepting is one click and the cost of scrutiny is real work.
// That asymmetry is only safe if nothing reaches the card unless the panel
// actually did the work. "Insufficient evidence" is a first-class outcome here,
// not a failure path.
//
// Pure: no Prisma, no inference, no I/O. The runner does the talking; this
// decides whether what came back is admissible.
//
// Spec: docs/superpowers/specs/2026-08-23-decision-concierge-design.md §4.3

import type { ProposalActionKind } from "./resolution-proposal-store";

/* -------------------------------------------------------------------------- */
/* Shapes                                                                     */
/* -------------------------------------------------------------------------- */

export type TriageConsequence = { optionId: string; text: string };
export type TriageDissent = { role: string; position: string; because: string };

/** What an admissible panel verdict carries. */
export type TriageVerdict = {
  recommendedAction: ProposalActionKind;
  /** The artifact, shaped for the action kind. */
  draft: Record<string, unknown>;
  /** What the owner is being asked to accept, in one line. */
  summary: string;
  consequences: TriageConsequence[];
  dissent: TriageDissent[];
  confidence: number | null;
};

export type VerdictRejection =
  | "no-verdict"
  | "unknown-action"
  | "missing-draft"
  | "missing-summary"
  | "missing-consequences"
  | "missing-dissent"
  | "unsupported-action";

export type VerdictAdmission =
  | { admissible: true; verdict: TriageVerdict }
  | { admissible: false; rejection: VerdictRejection; detail: string };

/**
 * Action kinds a panel may recommend TODAY. `amend-stance` and
 * `release-material` are modelled but their write paths are not wired, and a
 * proposal that cannot be applied must never reach the card — the owner would
 * accept it and nothing would happen.
 */
export const PANEL_RECOMMENDABLE_ACTIONS: readonly ProposalActionKind[] = [
  "answer_gap",
  "adopt_option",
  "no_change",
];

/** Which payload field each action kind must actually carry. */
const REQUIRED_DRAFT_FIELD: Partial<Record<ProposalActionKind, string>> = {
  answer_gap: "answer",
  adopt_option: "optionId",
  no_change: "reason",
};

/* -------------------------------------------------------------------------- */
/* Parsing                                                                    */
/* -------------------------------------------------------------------------- */

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readConsequences(value: unknown): TriageConsequence[] | null {
  if (!Array.isArray(value)) return null;
  const out: TriageConsequence[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    const optionId = asText(record?.optionId);
    const text = asText(record?.text);
    if (!optionId || !text) continue;
    out.push({ optionId, text });
  }
  return out;
}

/**
 * Dissent is read strictly, and the distinction that matters is between an
 * EMPTY list (the panel agreed) and an ABSENT field (nobody recorded whether
 * they agreed). The first is a fact worth showing; the second is a gap that
 * must not be presented as consensus.
 */
function readDissent(value: unknown): TriageDissent[] | null {
  if (!Array.isArray(value)) return null;
  const out: TriageDissent[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    const role = asText(record?.role);
    const position = asText(record?.position);
    if (!role || !position) continue;
    out.push({ role, position, because: asText(record?.because) ?? "" });
  }
  return out;
}

function readConfidence(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

/* -------------------------------------------------------------------------- */
/* Admission                                                                  */
/* -------------------------------------------------------------------------- */

const REJECTION_DETAIL: Record<VerdictRejection, string> = {
  "no-verdict": "The panel returned nothing that could be read as a verdict.",
  "unknown-action": "The panel named an action this platform does not have.",
  "unsupported-action":
    "The panel recommended an action whose write path is not wired, so accepting it would do nothing.",
  "missing-draft": "The panel recommended an action without drafting the thing it recommends.",
  "missing-summary": "The panel drafted a resolution without saying what it is.",
  "missing-consequences": "The panel did not say what follows from the options.",
  "missing-dissent":
    "The panel did not record whether anyone disagreed, so agreement cannot be claimed.",
};

/**
 * Decide whether a panel's output may become a proposal. Every rejection is a
 * named reason the runner records against the run, so a panel that keeps
 * failing the contract is visible rather than merely silent.
 */
export function admitTriageVerdict(raw: unknown): VerdictAdmission {
  const reject = (rejection: VerdictRejection): VerdictAdmission => ({
    admissible: false,
    rejection,
    detail: REJECTION_DETAIL[rejection],
  });

  const record = asRecord(raw);
  if (!record) return reject("no-verdict");

  const action = asText(record.recommendedAction) as ProposalActionKind | null;
  if (!action) return reject("no-verdict");
  if (!REQUIRED_DRAFT_FIELD[action] && !PANEL_RECOMMENDABLE_ACTIONS.includes(action)) {
    // Either a name that is not an action at all, or one that is modelled but
    // has no write path. Both are refusals; only the message differs.
    return reject(
      ["amend_stance", "release_material", "adjust_weight"].includes(action)
        ? "unsupported-action"
        : "unknown-action",
    );
  }

  const draft = asRecord(record.draft);
  const requiredField = REQUIRED_DRAFT_FIELD[action];
  if (!draft || !requiredField || !asText(draft[requiredField])) return reject("missing-draft");

  const summary = asText(record.summary);
  if (!summary) return reject("missing-summary");

  const consequences = readConsequences(record.consequences);
  if (consequences === null || consequences.length === 0) return reject("missing-consequences");

  const dissent = readDissent(record.dissent);
  if (dissent === null) return reject("missing-dissent");

  return {
    admissible: true,
    verdict: {
      recommendedAction: action,
      draft,
      summary,
      consequences,
      dissent,
      confidence: readConfidence(record.confidence),
    },
  };
}

/**
 * A consensus state that means the panel itself reported it could not ground a
 * recommendation. Checked BEFORE admission: a run that says
 * "insufficient-evidence" and still returns a confident draft is contradicting
 * itself, and the run's own report wins.
 */
export function panelReportedInsufficient(consensusState: string | null | undefined): boolean {
  return consensusState === "insufficient-evidence" || consensusState === "no-consensus";
}
