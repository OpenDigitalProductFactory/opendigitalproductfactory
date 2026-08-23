// The lifecycle of a drafted resolution (BI-3D0FB84B, EP-0AF96937).
//
// A proposal is a drafted answer to something an owner would otherwise face as
// a blank field: what to answer, which option to adopt, which weight to move,
// what a stance should say. It is advisory until a human rules on it, and
// accepting one never mutates doctrine from here — the caller routes an
// accepted proposal through the existing write path for its actionKind, and
// corpus changes still land as draft.
//
// TWO AXES, deliberately not collapsed into one:
//
//   status — what the HUMAN ruled
//     proposed ──accept──▶ accepted   the draft stood as written
//              ──amend───▶ amended    they edited it first; the edit is what
//                                     was accepted, and the delta from
//                                     draftPayload is the only honest measure
//                                     of whether the drafting earns its cost
//              ──reject──▶ rejected   terminal, reason kept — a rejection is
//                                     doctrine too
//
//   lifecycle — whether the ROW is still live (the canonical RecordLifecycle
//     convention, BI-C357FA5A). A draft whose decision got settled elsewhere,
//     or that a newer draft replaced, leaves `active` while `status` still
//     reads `proposed` — because nobody ever ruled on it. Collapsing these
//     would make "did a human decide this?" unanswerable after the fact.
//
// First ruling wins, exactly like ruleWeightAdjustmentProposal. A second caller
// gets `already-ruled` rather than overwriting a human's decision, and a
// terminal proposal can never be re-opened by a later inference run.
//
// Spec: docs/superpowers/specs/2026-08-23-decision-concierge-design.md §4.4

/* -------------------------------------------------------------------------- */
/* Vocabulary — the generated enums, never a second copy of their members     */
/* -------------------------------------------------------------------------- */

// Type-only: the enums are the DB's, but importing them as VALUES would drag
// the Prisma client into every unit test that touches this module.
import type {
  DecisionProposalAction,
  DecisionProposalScope,
  DecisionProposalStatus,
  RecordLifecycle,
} from "@dpf/db";

import { err, ok, type ActionResult } from "@/lib/shared/action-result";

export type ProposalScopeKind = DecisionProposalScope;
/** Typed against the generated union, so a schema change breaks the build here. */
export const PROPOSAL_SCOPE_KINDS: readonly ProposalScopeKind[] = ["interaction", "gap_cluster"];

/**
 * What accepting the proposal would do. Every kind names an EXISTING write
 * path — this model adds no new way to change doctrine.
 */
//   answer_gap       captureOrgBusinessAnswer — draft WWWD pages
//   adopt_option     the chosen option, recorded on the decision
//   adjust_weight    ruleWeightAdjustmentProposal at `ruled`
//   amend_stance     a wiki overlay draft against a named page
//   release_material the held-material release path
//   no_change        resolve with a recorded reason and change nothing
export type ProposalActionKind = DecisionProposalAction;
export const PROPOSAL_ACTION_KINDS: readonly ProposalActionKind[] = [
  "answer_gap",
  "adopt_option",
  "adjust_weight",
  "amend_stance",
  "release_material",
  "no_change",
];

export type ProposalStatus = DecisionProposalStatus;
export const PROPOSAL_STATUSES: readonly ProposalStatus[] = [
  "proposed",
  "accepted",
  "amended",
  "rejected",
];

/** The one status that still admits a ruling. */
const PROPOSED: ProposalStatus = "proposed";
/** Row liveness is a separate axis from what the human ruled (BI-C357FA5A). */
const ACTIVE: RecordLifecycle = "active";
const RETIRED: RecordLifecycle = "retired";

/** A proposal past `proposed` is settled and never re-opens. */
export function isTerminal(status: string): boolean {
  return status !== PROPOSED;
}

/** Open = nobody has ruled, and the row has not been retired under it. */
const OPEN_WHERE = { status: PROPOSED, lifecycle: ACTIVE } as const;

export function isProposalActionKind(value: unknown): value is ProposalActionKind {
  return typeof value === "string" && (PROPOSAL_ACTION_KINDS as readonly string[]).includes(value);
}

/** The failure codes this module returns. Callers match on these, not prose. */
export const INVALID_SCOPE = "invalid-scope";
export const ALREADY_OPEN = "already-open";
export const ALREADY_RULED = "already-ruled";
export const NOT_FOUND = "not-found";
export const AMEND_NEEDS_PAYLOAD = "amend-needs-payload";

/* -------------------------------------------------------------------------- */
/* Shapes                                                                     */
/* -------------------------------------------------------------------------- */

export type ProposalConsequence = { optionId: string; text: string };

/** One panel member who disagreed, and on what. */
export type ProposalDissent = { role: string; position: string; because: string };

export type CreateProposalInput = {
  scopeKind: ProposalScopeKind;
  /** DecisionInteraction ROW id (not the DI-* semantic id). Required for scopeKind=interaction. */
  interactionId?: string | null;
  /** Required for scopeKind=gap-cluster. */
  domainClass?: string | null;
  profileId: string;
  actionKind: ProposalActionKind;
  draftPayload: Record<string, unknown>;
  summary: string;
  consequences?: ProposalConsequence[];
  /**
   * Who disagreed. An empty array is a valid record of a panel that agreed;
   * OMITTING it is not, because "nobody dissented" and "nobody asked" must
   * never read the same on the card.
   */
  dissent: ProposalDissent[];
  confidence?: number | null;
  deliberationRunId?: string | null;
};

export type ProposalRow = {
  proposalId: string;
  scopeKind: string;
  interactionId: string | null;
  domainClass: string | null;
  profileId: string;
  actionKind: string;
  draftPayload: unknown;
  summary: string;
  consequences: unknown;
  dissent: unknown;
  confidence: number | null;
  deliberationRunId: string | null;
  status: string;
  lifecycle: string;
  ruledAt: Date | null;
  rulingNote: string | null;
  acceptedPayload: unknown;
  createdAt: Date;
};

type ProposalDelegate = {
  findFirst(args: unknown): Promise<unknown>;
  findMany(args: unknown): Promise<unknown>;
  create(args: unknown): Promise<unknown>;
  updateMany(args: unknown): Promise<{ count: number }>;
};

export type ProposalClient = { decisionResolutionProposal: ProposalDelegate };

/* -------------------------------------------------------------------------- */
/* Identity                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Stable id per thing-being-decided, so a re-run drafting the same resolution
 * cannot pile duplicates onto one decision. A gap-cluster proposal is keyed by
 * profile + domain because that is the unit the review queue groups by.
 */
export function buildProposalId(input: {
  scopeKind: ProposalScopeKind;
  interactionId?: string | null;
  profileId: string;
  domainClass?: string | null;
}): string {
  return input.scopeKind === "interaction"
    ? `DRP-i-${input.interactionId}`
    : `DRP-g-${input.profileId}-${input.domainClass}`;
}

/* -------------------------------------------------------------------------- */
/* Create                                                                     */
/* -------------------------------------------------------------------------- */

/** Failure codes are stable strings the caller matches on, not prose. */
export type CreateProposalFailure = "invalid-scope" | "already-open" | "already-ruled";
export type CreateProposalResult = ActionResult<{ proposalId: string }>;

/**
 * Draft a proposal. Refuses rather than duplicating when one is already open
 * for the same target, and refuses outright once a human has ruled — a later
 * inference run does not get to reopen a settled question.
 */
export async function createResolutionProposal(
  db: ProposalClient,
  input: CreateProposalInput,
): Promise<CreateProposalResult> {
  if (input.scopeKind === "interaction" && !input.interactionId) {
    return err(INVALID_SCOPE);
  }
  if (input.scopeKind === "gap_cluster" && !input.domainClass) {
    return err(INVALID_SCOPE);
  }

  const proposalId = buildProposalId(input);
  const existing = (await db.decisionResolutionProposal.findFirst({
    where: { proposalId },
    select: { status: true },
  })) as { status: string } | null;

  if (existing) {
    return err(isTerminal(existing.status) ? ALREADY_RULED : ALREADY_OPEN);
  }

  await db.decisionResolutionProposal.create({
    data: {
      proposalId,
      scopeKind: input.scopeKind,
      interactionId: input.interactionId ?? null,
      domainClass: input.domainClass ?? null,
      profileId: input.profileId,
      actionKind: input.actionKind,
      draftPayload: input.draftPayload,
      summary: input.summary,
      consequences: input.consequences ?? [],
      dissent: input.dissent,
      confidence: input.confidence ?? null,
      deliberationRunId: input.deliberationRunId ?? null,
      status: PROPOSED,
    },
  });
  return ok({ proposalId });
}

/* -------------------------------------------------------------------------- */
/* Read                                                                       */
/* -------------------------------------------------------------------------- */

const PROPOSAL_SELECT = {
  proposalId: true,
  scopeKind: true,
  interactionId: true,
  domainClass: true,
  profileId: true,
  actionKind: true,
  draftPayload: true,
  summary: true,
  consequences: true,
  dissent: true,
  confidence: true,
  deliberationRunId: true,
  status: true,
  lifecycle: true,
  ruledAt: true,
  rulingNote: true,
  acceptedPayload: true,
  createdAt: true,
};

/** The open proposal for one decision, if a panel has drafted one. */
export async function getOpenProposalForInteraction(
  db: ProposalClient,
  interactionRowId: string,
): Promise<ProposalRow | null> {
  return (await db.decisionResolutionProposal.findFirst({
    where: { interactionId: interactionRowId, ...OPEN_WHERE },
    select: PROPOSAL_SELECT,
    orderBy: { createdAt: "desc" },
  })) as ProposalRow | null;
}

/** Every proposal still waiting on a human, newest first. */
export async function listOpenProposals(db: ProposalClient): Promise<ProposalRow[]> {
  return (await db.decisionResolutionProposal.findMany({
    where: OPEN_WHERE,
    select: PROPOSAL_SELECT,
    orderBy: { createdAt: "desc" },
    take: 100,
  })) as ProposalRow[];
}

/* -------------------------------------------------------------------------- */
/* Rule                                                                       */
/* -------------------------------------------------------------------------- */

export type RulingInput = {
  proposalId: string;
  ruling: "accept" | "amend" | "reject";
  ruledByUserId: string;
  /** Required for `amend`: what the human actually accepted. */
  amendedPayload?: Record<string, unknown>;
  note?: string;
};

export type RulingResult = ActionResult<{
  status: ProposalStatus;
  payload: Record<string, unknown>;
}>;

/**
 * Record a human ruling and return the payload that should now be written
 * through — the amended text when they edited it, the draft when they did not.
 * This function does NOT perform that write: the actionKind adapters own it,
 * so the lifecycle stays testable without a live corpus and one failing write
 * cannot leave a proposal half-ruled.
 *
 * The update is conditional on status still being "proposed", so two
 * simultaneous rulings resolve to one winner at the database rather than in a
 * read-then-write race.
 */
export async function ruleResolutionProposal(
  db: ProposalClient,
  input: RulingInput,
): Promise<RulingResult> {
  if (input.ruling === "amend" && !input.amendedPayload) return err(AMEND_NEEDS_PAYLOAD);

  const existing = (await db.decisionResolutionProposal.findFirst({
    where: { proposalId: input.proposalId },
    select: { status: true, draftPayload: true },
  })) as { status: string; draftPayload: unknown } | null;

  if (!existing) return err(NOT_FOUND);
  if (isTerminal(existing.status)) return err(ALREADY_RULED);

  const status: ProposalStatus =
    input.ruling === "reject"
      ? "rejected"
      : input.ruling === "amend"
        ? "amended"
        : "accepted";

  const { count } = await db.decisionResolutionProposal.updateMany({
    where: { proposalId: input.proposalId, ...OPEN_WHERE },
    data: {
      status,
      ruledByUserId: input.ruledByUserId,
      ruledAt: new Date(),
      rulingNote: input.note ?? null,
      acceptedPayload: input.ruling === "amend" ? input.amendedPayload : null,
    },
  });
  if (count === 0) return err(ALREADY_RULED);

  const payload =
    input.ruling === "amend"
      ? (input.amendedPayload as Record<string, unknown>)
      : ((existing.draftPayload as Record<string, unknown> | null) ?? {});
  return ok({ status, payload });
}

/* -------------------------------------------------------------------------- */
/* Expiry                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Retire the open proposals for decisions that got resolved some other way.
 * Without this a stale draft keeps offering to answer a question nobody is
 * asking any more — and a human could accept it long after the fact.
 */
export async function expireProposalsForResolvedInteractions(
  db: ProposalClient,
  resolvedInteractionRowIds: string[],
): Promise<number> {
  if (resolvedInteractionRowIds.length === 0) return 0;
  const { count } = await db.decisionResolutionProposal.updateMany({
    where: { interactionId: { in: resolvedInteractionRowIds }, ...OPEN_WHERE },
    // The row leaves `active`; `status` still says `proposed`, which is the
    // truth — nobody ever ruled on it, the question just stopped being asked.
    data: {
      lifecycle: RETIRED,
      lifecycleAt: new Date(),
      lifecycleReason: "decision resolved elsewhere",
    },
  });
  return count;
}
