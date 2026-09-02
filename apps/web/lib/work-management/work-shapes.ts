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

import type { WorkroomShapeKey } from "./room-shapes";
import { COWORKER_STANDING_SHAPES } from "./coworker-standing-shapes";
import { ORCHESTRATION_SHAPES } from "./orchestration-shapes";
import { STANDING_SHAPES } from "./standing-operations-shapes";

/** §8.11.1 trigger vocabulary, verbatim and closed. */
export const WORK_SHAPE_TRIGGER_CLASSES = [
  "claim",
  "cadence",
  "deadline-horizon",
  "authority-change",
  "estate-drift",
  "evidence-decay",
  "escalation",
] as const;
export type WorkShapeTriggerClass = (typeof WORK_SHAPE_TRIGGER_CLASSES)[number];

/**
 * How a stage advances. `governed-decision` means the advance is a §8.4
 * decision — the kernel is consulted and a decision record is sealed — not a
 * status write. §8.11.2: which advances these are is a property of the
 * ACTIVITY, so a proactivity setting can never downgrade one.
 */
export type WorkShapeAdvance =
  | { kind: "status-change"; condition: string }
  | { kind: "governed-decision"; condition: string; decisionScope: string };

export type WorkShapeStage = {
  key: string;
  title: string;
  /** Who answers for this stage. `agent:<id>` | `role:<role>` | `person:<ref>`. */
  accountablePrincipalRef: string;
  advance: WorkShapeAdvance;
  /** Evidence kinds the stage is expected to leave behind (§8.11). */
  evidence: readonly string[];
};

export type WorkShapeStopCondition = {
  /** A shape MUST declare its failure exit, not only its successful one. */
  kind: "success" | "failure" | "budget";
  condition: string;
};

/** Allowed tools/capabilities this activity may consume. Empty is a declaration. */
export type WorkShapeGrant = string;

export type WorkShapeMeasure = {
  key: string;
  description: string;
};

export type WorkShapeBudget = {
  kind: "findings-per-run" | "cycles-per-window" | "spend";
  limit: number;
  unit: string;
};

export type WorkShapeDefinition = {
  key: string;
  /** Versioned: changing stages or gates is a new version, not an edit in place. */
  version: string;
  title: string;
  description: string;
  triggers: readonly WorkShapeTriggerClass[];
  stages: readonly WorkShapeStage[];
  stopConditions: readonly WorkShapeStopCondition[];
  /** Tools/capabilities the activity is allowed to use. Not a dispatcher. */
  grants: readonly WorkShapeGrant[];
  /** Named measures the activity is expected to leave on the ledger. */
  measures: readonly WorkShapeMeasure[];
  /** Numeric ceilings the runner must honour; pairs with the budget stop. */
  budgets: readonly WorkShapeBudget[];
  /** The activity is examined here whether or not it progressed. */
  reviewPoint: { everyDays: number; description: string };
  /** The room shape a consequential act inside this activity binds to. */
  collaborationShape: WorkroomShapeKey | null;
};

/** The definition contract runtime consumers read. No dispatch, schedule, or roster. */
export type WorkShapeDefinitionContract = Pick<
  WorkShapeDefinition,
  | "key"
  | "version"
  | "triggers"
  | "stages"
  | "stopConditions"
  | "grants"
  | "measures"
  | "budgets"
  | "reviewPoint"
>;

export function readWorkShapeDefinitionContract(
  shape: WorkShapeDefinition,
): WorkShapeDefinitionContract {
  return {
    key: shape.key,
    version: shape.version,
    triggers: shape.triggers,
    stages: shape.stages,
    stopConditions: shape.stopConditions,
    grants: shape.grants,
    measures: shape.measures,
    budgets: shape.budgets,
    reviewPoint: shape.reviewPoint,
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
      { kind: "success", condition: "No obligation, control review, or licence reference remains inside the horizon unfindinged." },
      { kind: "failure", condition: "The sweep cannot read the compliance substrate (no profile, no obligations, or a query error) — it stops and reports, and does NOT raise findings from an empty read." },
      { kind: "budget", condition: "More than 200 findings would be raised in one run — the run stops and escalates, rather than burying the ledger." },
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


/** The full registry: the anchor compliance shape plus the standing operations. */
const ALL_SHAPES: Record<string, WorkShapeDefinition> = { ...SHAPES, ...STANDING_SHAPES, ...COWORKER_STANDING_SHAPES, ...ORCHESTRATION_SHAPES };

export function listWorkShapes(): WorkShapeDefinition[] {
  return Object.values(ALL_SHAPES);
}

export function getWorkShape(key: string): WorkShapeDefinition | null {
  return ALL_SHAPES[key] ?? null;
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
  if (!shape.stopConditions.some((stop) => stop.kind === "failure")) {
    issues.push(`${shape.key}: no failure exit — only a successful one`);
  }
  if (!shape.stopConditions.some((stop) => stop.kind === "budget")) {
    issues.push(`${shape.key}: no budget stop — a self-starting shape without a spend ceiling is unbounded`);
  }
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
