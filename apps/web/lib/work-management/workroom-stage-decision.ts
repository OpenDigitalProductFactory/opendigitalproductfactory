// A human records the decision a governed Workroom stage is waiting on.
//
// A stage whose advance is `governed-decision` with a `role:` or `person:`
// principal becomes an `attention` plan: the drive refuses to execute it and
// stores `workroomDrive.pendingAttention`. Until this existed nothing let a
// person record that decision, so the room waited forever — the live example
// was dependency-advisory-watch, stage `decide`.
//
// The decision is NOT a second advance path. It is recorded as stage evidence
// through the one governed write (recordWorkCapsuleEvidence), of a kind the
// stage declared, with outcome `completed` and a human actor. The drive's
// existing earnEvidenceReceipts reads it and earns the completing receipt; the
// drive still owns the advance.
//
// WHO may decide (DI-A76F0C10EF14, accountable-owner fallback): the stage's
// role holder when a role binding exists. No substrate binds `role:*` refs
// today, so the decider is the room's resolved accountable human (explicit
// room owner -> inherited room -> organization top accountable owner). The
// evidence records `decidedBy: "accountable-owner-fallback"` and the principal
// the stage named, so the fallback is visible rather than silent.
//
// Pure: no Prisma, no React.

import { err, ok, type ActionResult } from "@/lib/shared/action-result";
import { isRecord } from "@/lib/shared/coerce";
import type { EffectiveHumanAccountability } from "./human-accountability";
import { declaresRefuseRoute } from "./work-shape-flow-graph";
import type { WorkShapeDefinitionContract } from "./work-shapes";

/** Evidence kinds that record a human decision. A governed stage must declare one. */
export const STAGE_DECISION_EVIDENCE_KINDS = ["decision-record"] as const;

/**
 * `refuse` (GPP Phase 3c PR-3c-3, BI-8875C9DF; design §6.2) is offered only on
 * a stage whose gate declares a refuse route, labelled "Send back": the drive
 * then routes the token back (or to the declared stop). No registry stage
 * declares one yet, so no existing stage offers it.
 */
export const STAGE_DECISION_CHOICES = ["accept", "patch", "defer", "refuse"] as const;
export type StageDecisionChoice = (typeof STAGE_DECISION_CHOICES)[number];

export const STAGE_DECISION_CHOICE_LABEL: Record<StageDecisionChoice, string> = {
  accept: "Accept",
  patch: "Patch",
  defer: "Defer",
  refuse: "Send back",
};

export type StageDecisionDecidedBy = "role-holder" | "accountable-owner-fallback";

export type PendingGovernedDecision = { stageKey: string; principalRef: string | null };

/**
 * Attention reasons a person clears by recording a stage decision:
 * `governed_decision`, and `gate_refused` (PR-3c-3), a refused stage whose
 * route is spent, which a new decision on that stage clears.
 */
const DECISION_ATTENTION_REASONS: readonly unknown[] = ["governed_decision", "gate_refused"];

/** The governed decision the room's drive last asked for, or null. */
export function readPendingGovernedDecision(workspaceState: unknown): PendingGovernedDecision | null {
  const drive = isRecord(workspaceState) && isRecord(workspaceState.workroomDrive)
    ? workspaceState.workroomDrive : null;
  const pending = isRecord(drive?.pendingAttention) ? drive.pendingAttention : null;
  if (!pending || !DECISION_ATTENTION_REASONS.includes(pending.reason)) return null;
  if (typeof pending.stageKey !== "string" || !pending.stageKey.trim()) return null;
  return {
    stageKey: pending.stageKey,
    principalRef: typeof pending.principalRef === "string" && pending.principalRef.trim() ? pending.principalRef : null,
  };
}

function pendingGovernedDecisionFrom(entry: unknown): PendingGovernedDecision | null {
  const pending = isRecord(entry) ? entry : null;
  if (!pending || !DECISION_ATTENTION_REASONS.includes(pending.reason)) return null;
  if (typeof pending.stageKey !== "string" || !pending.stageKey.trim()) return null;
  return {
    stageKey: pending.stageKey,
    principalRef: typeof pending.principalRef === "string" && pending.principalRef.trim() ? pending.principalRef : null,
  };
}

/**
 * Every governed decision the room's drive is waiting on (GPP Phase 3c
 * PR-3c-2, design §4.3 "Attention"). A graph room records one
 * `pendingAttentions` entry per waiting stage, so several parallel branches
 * can wait on people at once; a sequential room has no such list, and this
 * falls back to the single `pendingAttention`, exactly as
 * readPendingGovernedDecision reads it.
 */
export function readPendingGovernedDecisions(workspaceState: unknown): PendingGovernedDecision[] {
  const drive = isRecord(workspaceState) && isRecord(workspaceState.workroomDrive)
    ? workspaceState.workroomDrive : null;
  if (!Array.isArray(drive?.pendingAttentions)) {
    const single = readPendingGovernedDecision(workspaceState);
    return single ? [single] : [];
  }
  const out: PendingGovernedDecision[] = [];
  for (const entry of drive.pendingAttentions) {
    const pending = pendingGovernedDecisionFrom(entry);
    if (pending && !out.some((other) => other.stageKey === pending.stageKey)) out.push(pending);
  }
  return out;
}

export type GovernedDecisionStage = {
  key: string;
  title: string;
  condition: string;
  decisionScope: string | null;
  principalRef: string;
  evidenceKind: string;
  choices: StageDecisionChoice[];
  /** Stages before this one, in declared order, for the "what the room found" read. */
  priorStages: Array<{ key: string; title: string }>;
};

/**
 * Choices come from the stage's own condition. Accept and defer are always
 * offered; patch only when the condition names it (dependency-advisory-watch:
 * "accepts, patches, or defers with a date"). Other governed stages use other
 * verbs; they get the generic accept/defer rather than an invented vocabulary.
 * `refuse` ("Send back") is appended only when the stage's gate declares a
 * refuse route (PR-3c-3); without one the result is exactly as before.
 */
export function stageDecisionChoices(condition: string, hasRefuseRoute = false): StageDecisionChoice[] {
  const choices: StageDecisionChoice[] = /\bpatch/i.test(condition) ? ["accept", "patch", "defer"] : ["accept", "defer"];
  return hasRefuseRoute ? [...choices, "refuse"] : choices;
}

/** The governed stage a human can decide, or null when the shape does not make it one. */
export function governedDecisionStage(
  definition: WorkShapeDefinitionContract | null,
  stageKey: string,
): GovernedDecisionStage | null {
  if (!definition) return null;
  const index = definition.stages.findIndex((stage) => stage.key === stageKey);
  const stage = index >= 0 ? definition.stages[index] : null;
  if (!stage || stage.advance.kind !== "governed-decision") return null;
  const evidence = Array.isArray(stage.evidence) ? stage.evidence as readonly string[] : [];
  const evidenceKind = evidence.find((kind) => (STAGE_DECISION_EVIDENCE_KINDS as readonly string[]).includes(kind));
  if (!evidenceKind) return null;
  return {
    key: stage.key,
    title: stage.title,
    condition: stage.advance.condition,
    decisionScope: stage.advance.decisionScope ?? null,
    principalRef: stage.accountablePrincipalRef,
    evidenceKind,
    choices: stageDecisionChoices(stage.advance.condition, declaresRefuseRoute(definition, stage.key)),
    priorStages: definition.stages.slice(0, index).map((prior) => ({ key: prior.key, title: prior.title })),
  };
}

export type StageDecider =
  | { state: "resolved"; principalId: string; name: string; decidedBy: StageDecisionDecidedBy }
  | { state: "none"; message: string };

/** Who may record the decision. No role-binding substrate exists, so this is the accountable-owner fallback. */
export function resolveStageDecider(
  accountability: EffectiveHumanAccountability,
  displayName: string | null,
): StageDecider {
  if (accountability.state !== "resolved") {
    return { state: "none", message: "No accountable owner is recorded for this room, so no one can record this decision yet." };
  }
  return {
    state: "resolved",
    principalId: accountability.principalId,
    name: displayName ?? "the room's accountable owner",
    decidedBy: "accountable-owner-fallback",
  };
}

/** The plain refusal a non-decider sees. */
export function stageDeciderRefusal(decider: StageDecider): string {
  return decider.state === "resolved"
    ? `Only ${decider.name} (the room's accountable owner) can record this decision.`
    : decider.message;
}

export type StageDecisionInput = {
  stageKey: string;
  choice: string;
  deferUntil?: string | null;
  rationale?: string | null;
};

export type ValidStageDecision = {
  choice: StageDecisionChoice;
  deferUntil: string | null;
  rationale: string | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Validate the human's choice against what the stage offers. Returns a message on refusal. */
export function validateStageDecision(
  input: StageDecisionInput,
  stage: GovernedDecisionStage,
  now: Date,
): ActionResult<ValidStageDecision> {
  const choice = stage.choices.find((entry) => entry === input.choice);
  if (!choice) return err(`Choose one of: ${stage.choices.map((c) => STAGE_DECISION_CHOICE_LABEL[c]).join(", ")}.`);
  const rationale = input.rationale?.trim() ? input.rationale.trim().slice(0, 500) : null;
  if (choice !== "defer") return ok({ choice, deferUntil: null, rationale });
  const raw = input.deferUntil?.trim() ?? "";
  if (!DATE_RE.test(raw)) return err("A deferral needs a date to come back to it.");
  const until = new Date(`${raw}T00:00:00.000Z`);
  const today = now.toISOString().slice(0, 10);
  if (!Number.isFinite(until.getTime()) || until.toISOString().slice(0, 10) !== raw) {
    return err("That deferral date is not a real date.");
  }
  if (raw <= today) return err("A deferral date must be in the future.");
  return ok({ choice, deferUntil: raw, rationale });
}

/** The stage evidence the decision is recorded as — the ONE governed receipt path. */
export function buildStageDecisionEvidence(input: {
  stage: GovernedDecisionStage;
  decision: ValidStageDecision;
  decidedBy: StageDecisionDecidedBy;
  deciderName: string;
}) {
  const { stage, decision } = input;
  const verb = decision.choice === "defer"
    ? `deferred until ${decision.deferUntil}`
    : decision.choice === "patch" ? "chose to patch" : decision.choice === "refuse" ? "sent back" : "accepted";
  return {
    kind: stage.evidenceKind,
    stageKey: stage.key,
    outcome: "completed" as const,
    summary: `${input.deciderName} ${verb}: ${stage.title}.${decision.rationale ? ` ${decision.rationale}` : ""}`,
    result: {
      choice: decision.choice,
      ...(decision.deferUntil ? { deferUntil: decision.deferUntil } : {}),
      ...(decision.rationale ? { rationale: decision.rationale } : {}),
      decisionScope: stage.decisionScope,
      principalRef: stage.principalRef,
      decidedBy: input.decidedBy,
    },
  };
}

/** What each earlier stage found: its latest completed evidence summary. */
export function priorStageFindings(
  stage: GovernedDecisionStage,
  evidence: ReadonlyArray<{ payload: unknown; summary: string }>,
): Array<{ stageKey: string; title: string; summary: string }> {
  return stage.priorStages.flatMap((prior) => {
    const row = evidence.find((entry) => isRecord(entry.payload)
      && entry.payload.stageKey === prior.key && entry.payload.outcome === "completed");
    return row ? [{ stageKey: prior.key, title: prior.title, summary: row.summary }] : [];
  });
}

/** The room page's read model for the decision control. */
export type WorkroomStageDecisionView = {
  caseKey: string;
  roomRowId: string;
  stageKey: string;
  stageTitle: string;
  choices: StageDecisionChoice[];
  deciderName: string | null;
  canDecide: boolean;
  refusal: string | null;
  findings: Array<{ stageKey: string; title: string; summary: string }>;
};
