// apps/web/lib/a2a/coordination-proposal.ts
//
// A2A Coordination Layer — Slice 1: the pure proposal + reasoning-contract model
// (spec: docs/superpowers/specs/2026-08-11-a2a-coordination-layer-design.md).
//
// This is where the load-bearing boundary becomes real code:
//   - AI-REASONED: a coordination proposal is the AI's *output* — a plan that
//     REFERENCES canonical ids (BacklogItem / Epic / GAID), never a mutation.
//   - CODED SPINE: consequence classification + the human-gate rule are
//     deterministic functions here — AI never decides its own gate.
//   - HUMAN-GATED: any consequential / irreversible action is flagged for a gate.
//   - SOVEREIGNTY: planLocalApplication selects ONLY the actions targeting THIS
//     install's own items — a proposal is applied by each sovereign install to its
//     own targets; no path here mutates another instance's records.
//
// Pure and dependency-free — exhaustively unit-testable. No UI, no transport, no
// schema: transport (EP-A2A / #4124 federation ingress) and persistence sit above
// this in later slices.

/** The kinds of coordinated action a proposal can request. Additive; each maps to
 *  an EXISTING canonical operation (merge_backlog_items, link_backlog_item_to_epic,
 *  retire_backlog_item, coworker delegation) — this models the proposal over them,
 *  it does not shadow them. */
export const COORDINATION_ACTION_KINDS = [
  "merge-backlog-items",
  "link-to-epic",
  "retire-backlog-item",
  "delegate-task",
] as const;
export type CoordinationActionKind = (typeof COORDINATION_ACTION_KINDS)[number];

/** How reversible an action is — the axis the human gate keys on. */
export type ConsequenceTier = "reversible" | "consequential" | "irreversible";

/** Deterministic consequence classification (the coded spine — never AI-decided).
 *  A merge destroys the distinctness of the merged items (irreversible); retiring
 *  and delegating start/stop real work (consequential); grouping under an epic is
 *  trivially undone (reversible). */
const CONSEQUENCE_BY_KIND: Record<CoordinationActionKind, ConsequenceTier> = {
  "merge-backlog-items": "irreversible",
  "retire-backlog-item": "consequential",
  "delegate-task": "consequential",
  "link-to-epic": "reversible",
};

/** Tiers that MUST pass a human gate before the coded spine may enact them. */
const HUMAN_GATED_TIERS: ReadonlySet<ConsequenceTier> = new Set(["consequential", "irreversible"]);

/** A single proposed action over CANONICAL ids (never shadow copies). */
export interface CoordinationAction {
  kind: CoordinationActionKind;
  /** The installation that OWNS the target(s) — the sovereignty scope. Only that
   *  install may enact this action, against its own items. */
  targetInstallationId: string;
  /** Canonical ids this action touches (BacklogItem itemIds for merge/retire/epic;
   *  the target coworker GAID for delegate). At least one. */
  targetRefs: string[];
  /** merge → the survivor itemId; link-to-epic → the epic id; delegate → the task
   *  ref. Optional for actions that don't need a distinguished ref. */
  primaryRef?: string;
  /** Why the reasoning coworker proposes this — attached evidence, not authority. */
  rationale: string;
}

/** A reasoned coordination proposal: the AI's output. A plan that references
 *  canonical ids and is applied, per sovereignty, by each owning install. */
export interface CoordinationProposal {
  proposalId: string;
  /** GAID of the reasoning coworker that produced it (chain of custody). */
  proposingGaid: string;
  actions: CoordinationAction[];
  /** The reasoning behind the proposal — an artifact attached to it, never the
   *  authoritative state. */
  reasoning: string;
  evidenceRefs?: string[];
}

export function isCoordinationActionKind(value: unknown): value is CoordinationActionKind {
  return typeof value === "string" && (COORDINATION_ACTION_KINDS as readonly string[]).includes(value);
}

/** The consequence tier of an action (coded, deterministic). */
export function classifyConsequence(action: Pick<CoordinationAction, "kind">): ConsequenceTier {
  return CONSEQUENCE_BY_KIND[action.kind];
}

/** Whether an action must clear a human gate before the coded spine enacts it.
 *  This is the invariant: AI may PROPOSE anything; a consequential effect only
 *  happens after this returns false OR a human approves. */
export function requiresHumanGate(action: Pick<CoordinationAction, "kind">): boolean {
  return HUMAN_GATED_TIERS.has(classifyConsequence(action));
}

/** One local step derived from a proposal: an action THIS install owns, tagged
 *  with whether it needs a human gate. */
export interface LocalApplyStep {
  action: CoordinationAction;
  tier: ConsequenceTier;
  requiresGate: boolean;
}

/** The sovereignty-filtered plan for one install. */
export interface LocalApplyPlan {
  installationId: string;
  /** Steps this install may enact — targets it owns, in proposal order. */
  steps: LocalApplyStep[];
  /** Count of proposal actions targeting OTHER installs — never enacted here
   *  (the owning install applies those). Surfaced for transparency, not action. */
  foreignActionCount: number;
  /** True if any enactable step needs a human gate. */
  needsHumanApproval: boolean;
}

/** Sovereignty core: from a proposal, select ONLY the actions targeting this
 *  installation, tag each with its consequence/gate, and count (but never enact)
 *  the actions belonging to other installs. No mutation, no remote reach. */
export function planLocalApplication(
  proposal: Pick<CoordinationProposal, "actions">,
  installationId: string,
): LocalApplyPlan {
  const steps: LocalApplyStep[] = [];
  let foreignActionCount = 0;
  for (const action of proposal.actions) {
    if (action.targetInstallationId !== installationId) {
      foreignActionCount++;
      continue;
    }
    const tier = classifyConsequence(action);
    steps.push({ action, tier, requiresGate: HUMAN_GATED_TIERS.has(tier) });
  }
  return {
    installationId,
    steps,
    foreignActionCount,
    needsHumanApproval: steps.some((step) => step.requiresGate),
  };
}

/** Validate a proposal's SHAPE (the coded contract the AI must satisfy before the
 *  spine will consider it). Positive validation; returns violation codes, [] = ok. */
export function validateCoordinationProposal(value: unknown): string[] {
  const violations: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["proposal:not-an-object"];
  const p = value as Partial<CoordinationProposal>;
  if (typeof p.proposalId !== "string" || !p.proposalId.trim()) violations.push("proposal:missing-id");
  if (typeof p.proposingGaid !== "string" || !p.proposingGaid.trim()) violations.push("proposal:missing-proposing-gaid");
  if (typeof p.reasoning !== "string" || !p.reasoning.trim()) violations.push("proposal:missing-reasoning");
  if (!Array.isArray(p.actions) || p.actions.length === 0) {
    violations.push("proposal:no-actions");
  } else {
    p.actions.forEach((action, i) => {
      if (!action || typeof action !== "object") { violations.push(`action:${i}:not-an-object`); return; }
      if (!isCoordinationActionKind(action.kind)) violations.push(`action:${i}:invalid-kind`);
      if (typeof action.targetInstallationId !== "string" || !action.targetInstallationId.trim()) {
        violations.push(`action:${i}:missing-target-installation`);
      }
      if (!Array.isArray(action.targetRefs) || action.targetRefs.length === 0
          || !action.targetRefs.every((r) => typeof r === "string" && r.trim())) {
        violations.push(`action:${i}:missing-target-refs`);
      }
      if (typeof action.rationale !== "string" || !action.rationale.trim()) {
        violations.push(`action:${i}:missing-rationale`);
      }
    });
  }
  return violations;
}
