// Portable structural work-shape contracts; the application owns its registry,
// pinned definitions, validation, admission and policy adapters.
import type { StepCriticality } from "./step-criticality-contract.ts";
import type { DecisionScope } from "../decision-scopes.ts";
import type { OutcomeDisposition } from "../outcome-disposition.ts";
import type { WorkroomShapeKey, WorkShapeEvidenceKind, WorkShapeTriggerClass } from "./work-vocabulary.ts";

/**
 * How a stage advances. `governed-decision` means the advance is a §8.4
 * decision — the kernel is consulted and a decision record is sealed — not a
 * status write. §8.11.2: which advances these are is a property of the
 * ACTIVITY, so a proactivity setting can never downgrade one.
 */
export type WorkShapeAdvance =
  | { kind: "status-change"; condition: string }
  | { kind: "governed-decision"; condition: string; decisionScope: string; gate?: WorkShapeGate };

/**
 * The typed gate on a governed advance — GPP
 * (docs/architecture/gated-permissions-process.md) §7 elements 3, 4, 9 and
 * 11. It mirrors the shape document's `gate`
 * (gpp-shape-schema.ts asserts the two agree
 * at compile time). Spec: docs/superpowers/specs/
 * 2026-10-02-gpp-shape-notation-and-compiler-design.md §4.4; plan PR-3b-4
 * (BI-6DA17863).
 *
 * ADDITIVE AND OPTIONAL. It states, as data, what the drive already does for
 * a governed advance; no runtime reader consumes it. Absent keeps exactly
 * today's meaning. A shape carries one only once its `decisionScope` is
 * ratified (gate-ratification.ts), and adding one is a making-explicit change
 * that diffWorkShapeBinding classifies `unchanged`.
 */
export type WorkShapeGate = {
  authority: DecisionScope;
  gateKey?: string;
  mode: "shadow" | "enforced";
  blocking: boolean;
  resolution: "doctrine" | "accountable-human" | "doctrine-then-human";
  resolver?: { module: string; exportName: string };
  advisory?: readonly { authority: DecisionScope; gateKey?: string; blocking?: false }[];
  checkpoint?: { role: string; exactAction: boolean };
  escalation?: { role: string; whileWaiting: "hold" };
  /** Where a refuse verdict sends the token: a stop id or an earlier stage key. */
  onRefuse?: string;
};

type WorkShapeBindingCommon = {
  id: string;
  /** The binding's own version, separate from the shape version (GPP §2.1.1). */
  version: number;
  subjectScope?: string;
  validity?: { until: "stage-exit"; maxDuration?: string };
};

/**
 * A stage's Gated Permission binding (GPP §7.1, spec §4.4). Mirrors the shape
 * document's `binding`; `egress` is required for an environment boundary.
 * ADDITIVE AND OPTIONAL, like WorkShapeGate: no runtime reader consumes it,
 * and the compiler never writes GPP_BINDING_ENFORCEMENT or GPP_BINDINGS.
 */
export type WorkShapeBinding =
  | (WorkShapeBindingCommon & { enforcement: "absent" | "shadow" | "enforced"; egress?: readonly string[] })
  | (WorkShapeBindingCommon & { enforcement: "environment"; egress: readonly string[] });

export type WorkShapeStage = {
  key: string;
  title: string;
  /** Who answers for this stage. `agent:<id>` | `role:<role>` | `person:<ref>`. */
  accountablePrincipalRef: string;
  advance: WorkShapeAdvance;
  /** Optional review-depth floor; never grants authority. */
  criticality?: StepCriticality;
  /** Structural names; the application validates them against its profession registry. */
  requiredProfessions?: readonly string[];
  /** Evidence kinds the stage is expected to leave behind (§8.11). Typed
   *  against the vocabulary record_workroom_evidence accepts, so a stage cannot
   *  declare evidence it has no way to record. */
  evidence: readonly WorkShapeEvidenceKind[];
  /**
   * The platform tools this stage needs, by exact PLATFORM_TOOLS name.
   *
   * GPP (docs/architecture/gated-permissions-process.md, draft 0.1) binding
   * element 2 "Attachment" — a binding attaches to a stage, not only to a whole
   * shape — and element 5 "Capability set" (§7.1). This is the first stage-level
   * realization of both: the shape's `grants` stays the coarse per-shape room
   * ceiling, and this names the concrete tools inside it the stage reaches.
   *
   * Declaring a tool here never grants it. The dispatcher PINS the named tools
   * into the run's attachment budget (they are otherwise ranked out by prompt
   * relevance), and the agent ∩ user grant filter still decides whether each is
   * reachable at all. stage-tool-parity.test.ts checks the declaration: C-2
   * (every name resolves to a registered tool), C-4's necessary first condition
   * (the accountable agent holds the grant), and pin capacity.
   *
   * Omitted means undeclared: the stage dispatches exactly as before.
   */
  tools?: readonly string[];
  /** The stage's Gated Permission binding (spec §4.4). Optional and additive; see WorkShapeBinding. */
  binding?: WorkShapeBinding;
  /**
   * A non-interrupting stage deadline (GPP construct 11, compile target
   * `stage-deadline`). ADDITIVE AND OPTIONAL. Absent keeps today's meaning. A
   * shape that declares one runs on the drive's graph path, which pauses it
   * with `construct_not_executable` while the `stage-deadline` flag in
   * executable-constructs.ts is off (Phase 3c, BI-8875C9DF).
   */
  deadline?: WorkShapeStageDeadline;
  /**
   * A sub-shape call: the exact `key@version` the stage runs as a contained
   * child room (GPP construct 14). ADDITIVE AND OPTIONAL, gated like
   * `deadline` by the `sub-shape` flag. Typed `string`, not a template
   * literal, because the shape document schema validates it with a regex and
   * the lowered document must stay assignable to WorkShapeDefinition
   * (gpp-shape-schema.ts).
   */
  subShape?: string;
  /**
   * Side-effecting tools a drive-dispatched run of this stage may call without
   * a person (BI-C1781121). The same recorded decision a coworker self-task's
   * `mandatedTools` is: declaring the stage, and a room binding who answers
   * for it, IS the decision, so a declared write on the stage's scheduled run
   * is steered (escalation-gate `scheduled-mandate`) and not diverted to a
   * proposal. Only for non-governed stages; resolved by room-stage-mandate.ts.
   */
  mandatedTools?: readonly string[];
};

/** A stage deadline: raises a notice after `afterDays`, never moves the token. */
export type WorkShapeStageDeadline = { afterDays: number; description: string };

/**
 * An explicit flow graph (GPP constructs 12 and 13). ADDITIVE AND OPTIONAL:
 * absent means the implied sequence every current shape has. A shape that
 * declares one runs on the drive's graph path; a split, join or rework edge
 * pauses it with `construct_not_executable` while its flag is off.
 */
export type WorkShapeFlow = {
  nodes: readonly { id: string; type: "parallel-split" | "parallel-join"; pairs?: string }[];
  edges: readonly { from: string; to: string; rework?: { maxIterations: number } }[];
};

export type WorkShapeStopCondition = {
  /** A shape MUST declare its failure exit, not only its successful one. */
  kind: "success" | "failure" | "budget";
  condition: string;
  /**
   * WHAT KIND of stop this is, in the canonical vocabulary (BI-77CFC7BF).
   *
   * NOW REQUIRED. All 141 stop conditions across the seven shape files carry
   * one, so a new shape cannot declare a stop without deciding what happens
   * next — §9's mechanic, total by construction rather than by the author
   * remembering. It was optional while the back-classification was in flight.
   *
   * `kind` says whether the shape ended well, badly or out of budget. It does
   * NOT say what happens next, and is not a proxy for this field. Counted
   * across all seven files:
   *
   *   failure -> inconclusive 37, awaiting-person 5, refused 3, awaiting-input 2
   *   budget  -> awaiting-person 42, awaiting-input 3, refused 2
   *
   * 37 of the 47 `failure` exits are not refusals at all: they read "the
   * substrate cannot be read — the run stops and reports", which is AGENTS.md
   * §4's fail-open-on-infrastructure. The authors had been writing that
   * distinction as English inside `condition` because the type could not hold
   * it. Do not derive this field from `kind`.
   *
   * Budget stops anchor on §9 rule 3 — exhaustion converts to escalate, never
   * to a hard no — and the two that say "refused" in their own words are read
   * from the condition, not the kind.
   */
  disposition: OutcomeDisposition;
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
  /** The explicit flow graph (Phase 3c). Optional and additive; see WorkShapeFlow. */
  flow?: WorkShapeFlow;
};

/** The definition contract runtime consumers read. No dispatch, schedule, or roster. */
export type WorkShapeDefinitionContract = Pick<
  WorkShapeDefinition,
  | "key"
  | "version"
  // The activity's own words. The dispatcher briefs the coworker from these;
  // without them the brief is a bare stage key (BI-4A394B21).
  | "title"
  | "description"
  | "triggers"
  | "stages"
  | "stopConditions"
  | "grants"
  | "measures"
  | "budgets"
  | "reviewPoint"
  // Present only when the shape declares a flow (Phase 3c), so a sequential
  // contract keeps exactly its eleven own keys.
  | "flow"
>;
