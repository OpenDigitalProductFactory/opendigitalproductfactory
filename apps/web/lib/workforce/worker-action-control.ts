import type { WorkerClassification } from "@dpf/db";
import type { ProfessionJurisdiction } from "@dpf/db/wiki-taxonomy";

import type { RegulatoryAutonomyPolicyRecord } from "../autonomy/regulatory-ceiling";
import { resolveRegulatoryAutonomyCeiling } from "../autonomy/regulatory-ceiling";

import { consequencesFor, type WorkerClassificationConsequences } from "./worker-classification";

/**
 * The co-employment control (BI-B506AD2E).
 *
 * An employment event is about to make something happen to a worker — direct
 * their work, put them on a shift, enrol them in a review cycle, assign them
 * mandatory training, provision them an account. This answers whether that is
 * lawful for THIS worker in THEIR jurisdiction, before it runs.
 *
 * ## Why this ships before the actuator
 *
 * Sequencing decision `DI-DC833C327A44`. The instinct is to build the actuator
 * first and add the gate once there are rooms to gate. That ordering opens a
 * window in which employment events enrol workers in curricula, schedules and
 * review cycles with no classification check — and for a contingent worker that
 * window does not merely produce a wrong record, it produces exactly the
 * timestamped behavioural-control evidence a joint-employer or misclassification
 * finding turns on. A gate that arrives second has already failed at the thing it
 * exists for.
 *
 * ## Why the check is here and not in the UI
 *
 * The gate sits at the point of ACTION, not the point of display. Hiding a button
 * while leaving the action reachable is not a control; it is a UI convention that
 * an API call ignores. Every caller in the action path invokes this — the render
 * path may also use it to explain itself, but that is decoration.
 *
 * ## What this does NOT do
 *
 * It does not determine a classification, and it does not author jurisdictional
 * employment rules. The universal spine is `consequencesFor()` (BI-C61CEEA9);
 * where a jurisdiction narrows one further, that is policy DATA on the existing
 * `RegulatoryAutonomyPolicy` spine, not a second copy of the table and not legal
 * content asserted by the platform.
 */

/**
 * Activity classes this control adds to the existing `RegulatoryAutonomyPolicy`
 * spine. They are the `activityClass` key a policy row is written against; no
 * parallel policy model is introduced.
 */
export const WORKER_ACTIVITY_CLASSES = [
  /** Directing, scheduling, reviewing or training a worker — the behavioural-control axis. */
  "worker-direction",
  /** Making or revisiting a classification determination. */
  "worker-classification",
  /** Creating, granting or revoking a worker's access to systems. */
  "worker-provisioning",
] as const;
export type WorkerActivityClass = (typeof WORKER_ACTIVITY_CLASSES)[number];

/** The actions that must not run without passing this control. */
export const GATED_WORKER_ACTIONS = [
  "direct-work",
  "schedule-shift",
  "enrol-in-review-cycle",
  "assign-mandatory-training",
  "provision-access",
] as const;
export type GatedWorkerAction = (typeof GATED_WORKER_ACTIONS)[number];

type ActionSpec = {
  readonly activityClass: WorkerActivityClass;
  /** The universal consequence this action requires. */
  readonly requires: keyof Pick<
    WorkerClassificationConsequences,
    "directable" | "entersReviewCycles"
  >;
  /** Plain-language statement of the rule, for the refusal. */
  readonly rule: string;
  /**
   * What the operator may lawfully do instead. A refusal that does not name this
   * is a dead end, and a dead end is what makes people route around a control.
   */
  readonly lawfulAlternative: string;
};

const ACTIONS: Readonly<Record<GatedWorkerAction, ActionSpec>> = {
  "direct-work": {
    activityClass: "worker-direction",
    requires: "directable",
    rule: "The organisation may direct how and when the work is done only for a classification it may direct.",
    lawfulAlternative:
      "Agree the deliverable and the deadline in a statement of work, and leave how and when the work is done to the worker.",
  },
  "schedule-shift": {
    activityClass: "worker-direction",
    requires: "directable",
    rule: "Setting a worker's hours is behavioural control, which only a directable classification permits.",
    lawfulAlternative:
      "Publish the window the work must fall within and let the worker commit their own availability, rather than assigning a shift.",
  },
  "enrol-in-review-cycle": {
    activityClass: "worker-direction",
    requires: "entersReviewCycles",
    rule: "Performance review is an employment process; a classification outside review cycles is assessed against its engagement, not appraised.",
    lawfulAlternative:
      "Record delivery against the agreed scope on the engagement itself, and use that at renewal.",
  },
  "assign-mandatory-training": {
    activityClass: "worker-direction",
    requires: "directable",
    rule: "Mandating training directs how the work is done, which only a directable classification permits.",
    lawfulAlternative:
      "Where a competency is genuinely required, make it a condition of the engagement in a statement-of-work amendment, or offer the training without mandating it.",
  },
  "provision-access": {
    activityClass: "worker-provisioning",
    requires: "directable",
    rule: "Provisioning a worker into internal systems as an employee integrates them into the organisation, which is an integration-test factor.",
    lawfulAlternative:
      "Grant scoped, time-bound access to only the systems the engagement needs, expiring with the engagement term.",
  },
};

/** Why an action was refused. */
export type WorkerActionRefusalReason =
  /** No classification is recorded, so lawfulness cannot be established. */
  | "classification-unresolved"
  /** No jurisdiction resolves, so no rule can be looked up. */
  | "jurisdiction-unresolved"
  /** The classification itself forbids the action, in every jurisdiction. */
  | "classification-forbids"
  /** The classification permits it universally, but this jurisdiction narrows it. */
  | "jurisdiction-narrows";

export type WorkerActionDecision =
  | {
      readonly permitted: true;
      readonly action: GatedWorkerAction;
      readonly activityClass: WorkerActivityClass;
      readonly classification: WorkerClassification;
      readonly jurisdiction: ProfessionJurisdiction;
    }
  | {
      readonly permitted: false;
      readonly action: GatedWorkerAction;
      readonly activityClass: WorkerActivityClass;
      readonly reason: WorkerActionRefusalReason;
      /** Null exactly when the reason is `classification-unresolved`. */
      readonly classification: WorkerClassification | null;
      /** Null when the jurisdiction is what could not be resolved. */
      readonly jurisdiction: ProfessionJurisdiction | null;
      /** The governing rule, in words an operator can act on. */
      readonly rule: string;
      /** What may lawfully be done instead. Never empty. */
      readonly lawfulAlternative: string;
    };

export type CheckWorkerActionInput = {
  readonly action: GatedWorkerAction;
  /** Null means unresolved — the control refuses rather than assuming. */
  readonly classification: WorkerClassification | null;
  /** Null means unresolved. Never pass `global` as a stand-in for unknown. */
  readonly jurisdiction: ProfessionJurisdiction | null;
  /**
   * Active `RegulatoryAutonomyPolicy` rows. Omitted or empty means no
   * jurisdiction narrows the universal answer — which is the honest state of a
   * platform that has not authored jurisdictional rule content, not a licence to
   * permit more than the classification allows.
   */
  readonly policies?: readonly RegulatoryAutonomyPolicyRecord[];
  readonly industry?: string | null;
  readonly asOf?: Date;
};

/**
 * Decide whether an action may run against a worker.
 *
 * A refusal is a STOP, not a warning and not a no-op (AGENTS.md §1). There is no
 * advisory mode and no override parameter: the design accepts a one-graph
 * architecture over the market's two-system answer to co-employment ONLY because
 * this gate is enforced at the point of action. If it ever degrades to advisory,
 * that trade is void.
 */
export function checkWorkerAction(input: CheckWorkerActionInput): WorkerActionDecision {
  const spec = ACTIONS[input.action];
  const base = { action: input.action, activityClass: spec.activityClass } as const;

  // An unknown classification is not a permissive default. Every guess errs
  // toward directing someone the organisation may not direct.
  if (!input.classification) {
    return {
      ...base,
      permitted: false,
      reason: "classification-unresolved",
      classification: null,
      jurisdiction: input.jurisdiction,
      rule: "A worker's classification must be recorded by a human before an action that depends on it can run.",
      lawfulAlternative:
        "Record a worker classification determination for this person, then retry. Until then, nothing that directs, schedules, reviews or provisions them may run.",
    };
  }

  if (!input.jurisdiction) {
    return {
      ...base,
      permitted: false,
      reason: "jurisdiction-unresolved",
      classification: input.classification,
      jurisdiction: null,
      rule: "The employment rules that apply cannot be looked up without knowing which jurisdiction governs the worker.",
      lawfulAlternative:
        "Set the employment jurisdiction on the worker's work location, then retry.",
    };
  }

  // 1. The universal spine. If the classification forbids it, no jurisdiction
  //    policy can permit it — narrowing only ever removes.
  if (!consequencesFor(input.classification)[spec.requires]) {
    return {
      ...base,
      permitted: false,
      reason: "classification-forbids",
      classification: input.classification,
      jurisdiction: input.jurisdiction,
      rule: spec.rule,
      lawfulAlternative: spec.lawfulAlternative,
    };
  }

  // 2. Jurisdictional narrowing, read from the policy spine that already exists.
  //    The worker's own jurisdiction is the employing-basis profile, so a policy
  //    matches this WORKER rather than the organisation as a whole.
  const ceiling = resolveRegulatoryAutonomyCeiling({
    policies: input.policies ?? [],
    profile: {
      operatesIn: [],
      sellsTo: [],
      employsIn: [input.jurisdiction],
      dataResidency: [],
    },
    industry: input.industry ?? null,
    activityClass: spec.activityClass,
    asOf: input.asOf ?? null,
  });

  // `defaulted` means no policy row matched at all. That is the ordinary state
  // while jurisdictional rule content is unauthored, and it must NOT refuse a
  // classification-permitted action — otherwise the control blocks lawful
  // employee work everywhere and gets switched off, which is how a gate dies.
  if (!ceiling.defaulted && ceiling.humanControlRequired) {
    return {
      ...base,
      permitted: false,
      reason: "jurisdiction-narrows",
      classification: input.classification,
      jurisdiction: input.jurisdiction,
      rule: `${input.jurisdiction} narrows this for a ${input.classification}: ${ceiling.reason}`,
      lawfulAlternative: `${spec.lawfulAlternative} A person with authority in ${input.jurisdiction} may take this step directly.`,
    };
  }

  return {
    ...base,
    permitted: true,
    classification: input.classification,
    jurisdiction: input.jurisdiction,
  };
}

/**
 * Operator-facing sentence for a refusal — the classification, the jurisdiction,
 * the rule and the lawful alternative, in that order.
 *
 * AC-ELA-011 requires a refusal to name all four. This is the single place that
 * formats them so a caller cannot drop one and leave the operator stuck.
 */
export function describeWorkerActionRefusal(
  decision: Extract<WorkerActionDecision, { permitted: false }>,
  workerName: string,
): string {
  const who =
    decision.classification && decision.jurisdiction
      ? `${workerName} is recorded as ${decision.classification} in ${decision.jurisdiction}.`
      : decision.classification
        ? `${workerName} is recorded as ${decision.classification}, but their employment jurisdiction is not set.`
        : `${workerName} has no recorded worker classification.`;

  return `${who} ${decision.rule} Instead: ${decision.lawfulAlternative}`;
}
