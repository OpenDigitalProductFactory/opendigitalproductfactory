// apps/web/lib/work-management/work-shapes.ts
//
// Declared work shapes — TAK §8.11 ("Governed Activity Shapes and Triggers").
//
// Action gating governs a single tool call. It does not govern the standing
// ACTIVITY that produces a stream of such calls. Once a coworker can start work
// on a schedule or on a deadline, the governed unit is the activity shape: what
// starts it, what stages it moves through, who answers for each, which advances
// need a governed decision rather than a status change, what stops it, and when
// it is reviewed whether or not it moved.
//
// This is NOT `room-shapes.ts`. That module declares the COLLABORATION shape of
// one consequential act — who must be in the room. This declares the ACTIVITY
// shape of standing work over time. A work shape names its collaboration shape
// (`collaborationShape`) so the two compose instead of competing.
//
// Projection, not a second substrate: `projectWorkShapeCycleBoundary` emits the
// cycle-boundary record the existing WorkCapsule / room adapter already stores
// (room-cycle-adapter.ts — trigger, accountablePrincipalRef, expectedReviewAt,
// stopConditions). A shape instance is a room cycle with a declared shape, not
// a new kind of row. `backlogItemId` is nullable and `outcomeAnchor` already
// admits a coworker anchor, so coworker-owned standing work fits as-is.

import { validateStopExits } from "@dpf/validators/gpp/stop-exits";
import { ACCEPTANCE_VERIFICATION_SHAPES } from "./acceptance-verification-shape";
import { COWORKER_STANDING_SHAPES } from "./coworker-standing-shapes";
import { COWORKER_STANDING_SHAPES_CRAFT } from "./coworker-standing-shapes-craft";
import { COWORKER_STANDING_SHAPES_OPERATE } from "./coworker-standing-shapes-operate";
import { DELIVERY_SHAPES } from "./delivery-shapes";
import { GENERATED_WORK_SHAPES } from "./generated/index.generated";
import { ORCHESTRATION_SHAPES } from "./orchestration-shapes";
import { PLATFORM_REVIEW_SHAPES } from "./platform-review-shape";
import { STANDING_SHAPES } from "./standing-operations-shapes";
import { WORK_SHAPE_PRIOR_VERSIONS } from "./work-shape-prior-versions";

// Structural contracts and vocabularies have one portable owner. This module
// retains the application registry and its existing validation/read adapters.
import type { WorkShapeDefinition, WorkShapeDefinitionContract } from "@dpf/validators/gpp/work-shape-contracts";
import { WORK_SHAPE_TRIGGER_CLASSES, type WorkShapeTriggerClass } from "@dpf/validators/gpp/work-vocabulary";
export { WORK_SHAPE_TRIGGER_CLASSES, type WorkShapeTriggerClass } from "@dpf/validators/gpp/work-vocabulary";
export type {
  WorkShapeAdvance,
  WorkShapeGate,
  WorkShapeBinding,
  WorkShapeStage,
  WorkShapeStageDeadline,
  WorkShapeFlow,
  WorkShapeStopCondition,
  WorkShapeGrant,
  WorkShapeMeasure,
  WorkShapeBudget,
  WorkShapeDefinition,
  WorkShapeDefinitionContract,
} from "@dpf/validators/gpp/work-shape-contracts";

export function readWorkShapeDefinitionContract(
  shape: WorkShapeDefinition,
): WorkShapeDefinitionContract {
  return {
    key: shape.key,
    version: shape.version,
    title: shape.title,
    description: shape.description,
    triggers: shape.triggers,
    stages: shape.stages,
    stopConditions: shape.stopConditions,
    grants: shape.grants,
    measures: shape.measures,
    budgets: shape.budgets,
    reviewPoint: shape.reviewPoint,
    ...(shape.flow !== undefined ? { flow: shape.flow } : {}),
  };
}

// ── the registry ─────────────────────────────────────────────────────────────

/**
 * Anchor instance. The compliance officer's standing watch over recorded
 * obligations, control reviews, and licence expiries — the shape that makes
 * `Obligation.frequency`, `Control.reviewFrequency` / `nextReviewDate` /
 * `lastReviewedAt`, and `LicenseRequirementReference.staleAfterDays` /
 * `renewalCadenceHint` into controls that are actually in force rather than
 * columns that read to an operator as if they were (§8.11.1, dead-intent rule).
 */
export const OBLIGATION_ASSURANCE_WATCH_SHAPE_KEY = "obligation-assurance-watch";

const SHAPES: Record<string, WorkShapeDefinition> = {
  [OBLIGATION_ASSURANCE_WATCH_SHAPE_KEY]: {
    key: OBLIGATION_ASSURANCE_WATCH_SHAPE_KEY,
    version: "1.0.0",
    title: "Obligation assurance watch",
    description:
      "The compliance officer sweeps recorded obligations, control reviews, and licence expiries "
      + "against a look-ahead window, raises a finding for each one falling due, and hands the "
      + "accountable owner a decision. It does not decide the response itself.",
    triggers: ["cadence", "deadline-horizon"],
    stages: [
      {
        key: "sweep",
        title: "Sweep the deadline horizon",
        accountablePrincipalRef: "agent:compliance-officer",
        advance: {
          kind: "status-change",
          condition: "Every obligation, control review, and licence reference in scope has been read.",
        },
        evidence: ["assurance-run"],
      },
      {
        key: "raise",
        title: "Raise findings onto the assurance ledger",
        accountablePrincipalRef: "agent:compliance-officer",
        advance: {
          kind: "status-change",
          condition: "Each item inside the horizon has an open finding; each item that has left the horizon is reconciled.",
        },
        evidence: ["assurance-finding"],
      },
      {
        key: "decide",
        title: "Decide the response to each finding",
        // The owner of the obligation answers for the response, never the sweep.
        accountablePrincipalRef: "role:compliance-owner",
        advance: {
          kind: "governed-decision",
          condition: "The accountable owner accepts, defers with a date, or remediates.",
          decisionScope: "compliance-obligation-response",
        },
        evidence: ["decision-record"],
      },
    ],
    stopConditions: [
      { kind: "success", condition: "No obligation, control review, or licence reference remains inside the horizon unfindinged.", disposition: "proceed" },
      { kind: "failure", condition: "The sweep cannot read the compliance substrate (no profile, no obligations, or a query error) — it stops and reports, and does NOT raise findings from an empty read.", disposition: "inconclusive" },
      { kind: "budget", condition: "More than 200 findings would be raised in one run — the run stops and escalates, rather than burying the ledger.", disposition: "awaiting-person" },
    ],
    grants: ["tool:read"],
    measures: [
      { key: "findings-raised", description: "Findings opened onto the assurance ledger in one run." },
    ],
    budgets: [
      { kind: "findings-per-run", limit: 200, unit: "findings" },
    ],
    reviewPoint: {
      everyDays: 30,
      description:
        "The watch is reviewed monthly whether or not it raised anything: a sweep that has found "
        + "nothing for a month is as likely to be broken as to be reassuring.",
    },
    collaborationShape: "approval-sign-off",
  },
};


/**
 * The full registry: the anchor compliance shape, the standing operations, the
 * five delivery shapes, one orchestration cycle per IT4IT value stream, and the
 * acceptance-verification steward activity, and the platform post-implementation
 * review (BI-AA47C672).
 */
const ALL_SHAPES: Record<string, WorkShapeDefinition> = {
  ...SHAPES,
  ...STANDING_SHAPES,
  ...COWORKER_STANDING_SHAPES,
  ...COWORKER_STANDING_SHAPES_OPERATE,
  ...COWORKER_STANDING_SHAPES_CRAFT,
  ...DELIVERY_SHAPES,
  ...ORCHESTRATION_SHAPES,
  ...ACCEPTANCE_VERIFICATION_SHAPES,
  ...PLATFORM_REVIEW_SHAPES,
};

// A compiled shape (GPP Phase 3b, PR-3b-6) is registered by reference, in its
// original position in its family file, so listWorkShapes() keeps its order.
// The generated index is read only to prove that: every generated definition
// is registered here under its key, as the very same object. Nothing generated
// is spread into ALL_SHAPES.
for (const generated of GENERATED_WORK_SHAPES) {
  if (ALL_SHAPES[generated.key] !== generated) {
    throw new Error(
      `work-shapes: the generated definition ${generated.key}@${generated.version} is not the registered one; `
        + "reference its generated constant in place of the hand-written literal.",
    );
  }
}

export function listWorkShapes(): WorkShapeDefinition[] {
  return Object.values(ALL_SHAPES);
}

export function getWorkShape(key: string): WorkShapeDefinition | null {
  return ALL_SHAPES[key] ?? null;
}

/** An exact `key@version`: the current definition, or a superseded one a live
 *  room may still pin (work-shape-prior-versions.ts). Null when neither holds it. */
export function getWorkShapeVersion(key: string, version: string): WorkShapeDefinition | null {
  const current = getWorkShape(key);
  if (current?.version === version) return current;
  return WORK_SHAPE_PRIOR_VERSIONS.find((shape) => shape.key === key && shape.version === version) ?? null;
}

/** Does this shape describe work that RECURS rather than finishing?
 *
 *  Read from the shape's own declared triggers, not a hand-kept list: every
 *  standing operations shape declares `cadence`, every finite delivery shape
 *  declares `claim`. A new standing shape is therefore standing the day it is
 *  declared, with nothing else to remember to update (BI-97B24FB5).
 */
/** The work-shape key a room declares on its scope claims, e.g. from
 *  "adopter-health-watch@1.0.0" -> "adopter-health-watch".
 *
 *  scopeClaims is an untyped JSON array written by several writers, so read it
 *  defensively. Shared rather than re-implemented per caller: the room's
 *  declared shape now decides its projection, so every reader must agree on
 *  what the room declared (BI-97B24FB5).
 */
export function readDeclaredWorkShapeKey(scopeClaims: unknown): string | null {
  if (!Array.isArray(scopeClaims)) return null;
  for (const claim of scopeClaims) {
    if (!claim || typeof claim !== "object") continue;
    const ref = (claim as Record<string, unknown>).workShape;
    if (typeof ref === "string" && ref.length > 0) return ref.split("@")[0] ?? null;
  }
  return null;
}

/**
 * Whether a shape recurs: it declares the `cadence` trigger class, so it is a
 * standing activity that runs again every cycle. A shape without it (a
 * claim-triggered delivery, for example) runs once: when its run succeeds that
 * run is final (WWMD DI-8DCB9A4B566C, BI-853120EE).
 */
export function workShapeRecurs(shape: Pick<WorkShapeDefinition, "triggers">): boolean {
  return shape.triggers.includes("cadence");
}

export function isStandingWorkShape(key: string): boolean {
  const shape = getWorkShape(key);
  return shape ? workShapeRecurs(shape) : false;
}

/** Agent ids that a declared shape names as accountable for at least one stage. */
export function agentsWithDeclaredShape(): string[] {
  const agents = new Set<string>();
  for (const shape of listWorkShapes()) {
    for (const stage of shape.stages) {
      if (stage.accountablePrincipalRef.startsWith("agent:")) {
        agents.add(stage.accountablePrincipalRef.slice("agent:".length));
      }
    }
  }
  return [...agents].sort();
}

// ── conformance ──────────────────────────────────────────────────────────────

/**
 * The §8.11 MUSTs, as a check rather than a comment. A conformance test runs
 * this over the whole registry: recurring work that can start itself and cannot
 * stop itself is an unbounded grant of authority however narrow each tool call is.
 */
export function validateWorkShape(shape: WorkShapeDefinition): string[] {
  const issues: string[] = [];
  if (!shape.key) issues.push("shape has no stable identifier");
  if (!/^\d+\.\d+\.\d+$/.test(shape.version)) issues.push(`${shape.key}: version must be semver`);
  if (shape.triggers.length === 0) issues.push(`${shape.key}: no trigger set`);
  for (const trigger of shape.triggers) {
    if (!(WORK_SHAPE_TRIGGER_CLASSES as readonly string[]).includes(trigger)) {
      issues.push(`${shape.key}: trigger "${trigger}" is outside the §8.11.1 vocabulary`);
    }
  }
  if (shape.stages.length === 0) issues.push(`${shape.key}: no stages`);
  for (const stage of shape.stages) {
    if (!stage.accountablePrincipalRef) {
      issues.push(`${shape.key}/${stage.key}: no accountable principal`);
    }
    if (!stage.advance.condition) issues.push(`${shape.key}/${stage.key}: no advance condition`);
  }
  issues.push(...validateStopExits(shape));
  if (!(shape.reviewPoint.everyDays > 0)) issues.push(`${shape.key}: no review point`);
  return issues;
}

// ── projection onto the existing room-cycle substrate ────────────────────────

export type ProjectedWorkShapeCycle = {
  kind: "work-room-cycle";
  version: 1;
  cycleKey: string;
  trigger: string;
  objective: string;
  accountablePrincipalRef: string;
  expectedReviewAt: string;
  stopConditions: string[];
  measureSummary: string;
  contextRefs: [];
};

/**
 * Emit the cycle boundary the room adapter already parses
 * (`parseStoredWorkroomCycle`), so an instance of a declared shape is a normal
 * room cycle carrying its shape, not a parallel record.
 */
export function projectWorkShapeCycleBoundary(input: {
  shape: WorkShapeDefinition;
  trigger: WorkShapeTriggerClass;
  startedAt: Date;
  cycleKey?: string;
}): ProjectedWorkShapeCycle {
  const { shape, trigger, startedAt } = input;
  const reviewAt = new Date(startedAt.getTime() + shape.reviewPoint.everyDays * 86_400_000);
  const owner = shape.stages[0]?.accountablePrincipalRef ?? "role:unassigned";
  return {
    kind: "work-room-cycle",
    version: 1,
    cycleKey: input.cycleKey ?? `${shape.key}@${shape.version}:${startedAt.toISOString().slice(0, 10)}`,
    trigger: `${trigger}:${shape.key}@${shape.version}`,
    objective: shape.title,
    accountablePrincipalRef: owner,
    expectedReviewAt: reviewAt.toISOString(),
    stopConditions: shape.stopConditions.map((stop) => `${stop.kind}: ${stop.condition}`),
    measureSummary: shape.description,
    contextRefs: [],
  };
}
