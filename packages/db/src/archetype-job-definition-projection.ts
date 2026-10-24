import type { OperationalValueStream } from "@dpf/storefront-templates";
import {
  JOB_DEFINITION_AXES,
  type AxisAnswer,
  type JobDefinitionAxis,
} from "./coworker-job-definition";

/**
 * Project an org's derived Operational Value Stream Model into JOB definitions.
 *
 * THE THIRD PROJECTION. `archetype-value-stream-projection.ts` compiles the OVSM
 * into the `/ea/value-streams` canvas; `archetype-room-definition-projection.ts`
 * compiles the same OVSM into the room definitions a coworker can hold. That
 * file states the invariant both share: *"a stage on the canvas is a room, and a
 * room is a stage on the canvas."*
 *
 * This module compiles the same OVSM into the third face of one model:
 *
 *     A stage on the canvas is a room.
 *     The ROLE accountable for that stage is a JOB.
 *
 * `responsibleRole` is the join, and it lives in TWO places. The OVSM's lanes
 * (`streams`) each carry a NON-NULLABLE `responsibleRole`; a stage carries a
 * NULLABLE one. Probed against the live catalogue of 107 archetypes: every one
 * of the 110 lanes names a role, covering 877 stages, while 861 of those stages
 * name none themselves. So the lane is the primary source and the stage is an
 * override — reading only the stage (as the room projection's
 * `requiredParticipantRole` does) sees almost nothing.
 *
 * WHY THIS ANSWERS THE TAILORING PROBLEM WITHOUT NEW MACHINERY. A dental
 * practice's scheduling role and a farm's differ because their value streams
 * differ — not because somebody hand-wrote two job descriptions. The OVSM is
 * already derived per archetype and overridable per organisation (the
 * derive-with-override family), so archetype tailoring and local context are
 * properties this inherits rather than features it adds.
 *
 * THE INVERSION THAT MATTERS. The room projection maps ONE STAGE to one room.
 * This maps ONE ROLE to the stages it owns, because a job is a bundle of
 * accountabilities, not a single duty. A role appearing in four stages has one
 * job with four accountabilities — which is also why the job's measures and
 * gates are the UNION across its stages.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not invent an answer it cannot
 * derive. An axis the OVSM cannot speak to is returned UNANSWERED, not
 * plausibly filled: the whole point of the contract
 * (`coworker-job-definition.ts`) is that unanswered is visible, and a projection
 * that guessed would defeat it more quietly than the old door ever did.
 *
 * Pure and side-effect free, like its sibling's `buildArchetypeRoomDefinitions`,
 * so it is asserted without a database.
 *
 * Design: docs/superpowers/specs/2026-09-16-coworker-job-definition-and-establishment-contract-design.md §4
 */

/** One accountability: a stage this role owns, and what that stage owes. */
export interface JobAccountability {
  stageKey: string;
  label: string;
  streamKey: string;
  order: number;
  /** What has to arrive for this accountability to start. */
  trigger: string | null;
  /** What the role owes when it is done. */
  outcome: string | null;
  /** Work the business repeats — so this accountability is standing, not finite. */
  standing: boolean;
}

export interface ArchetypeJobDefinition {
  definitionId: string;
  /** The role as the value stream names it, e.g. "Bookkeeper". */
  role: string;
  archetypeId: string;
  /** Value streams this role works across. */
  streamKeys: string[];
  accountabilities: JobAccountability[];
  /** Union of the gates on every stage it owns — what its work must pass. */
  gateBindings: string[];
  /** Union of the metrics its stages are measured by. */
  measureBindings: string[];
  /**
   * What this role must KNOW before it acts — the operator's "priming".
   *
   * Derived, not authored: the constraints its stages place on it (trust gates)
   * and the business domains those stages work in (capability bindings). A
   * gate like `clinical-adjacent-no-advice` is not a checkbox, it is a fact the
   * role has to hold before its first turn.
   */
  requiredContext: {
    /** Constraints its stages impose. The highest-value half of priming. */
    constraints: string[];
    /** Business domains its stages operate in. */
    domains: string[];
  };
  /** True when any owned accountability is standing work. */
  hasStandingWork: boolean;
  /**
   * The nine axes, answered where the OVSM can answer them and LEFT UNANSWERED
   * where it cannot. The unanswered ones are the honest worklist for whoever
   * establishes this coworker.
   */
  axes: Partial<Record<JobDefinitionAxis, AxisAnswer>>;
}

export interface ArchetypeJobDefinitionSet {
  archetypeId: string;
  archetypeName: string;
  category: string;
  definitions: ArchetypeJobDefinition[];
  /**
   * Stages that name no responsible role. A stage nobody owns is a finding, not
   * a blank: it is work the archetype says the business does with no answer to
   * who does it.
   */
  unownedStageKeys: string[];
}

function satisfied(evidence: string): AxisAnswer {
  return { state: "satisfied", evidence };
}

/**
 * Derive the axes this projection can genuinely answer from the value stream.
 *
 * Five of nine are derivable. The other four — authority, qualifications,
 * context and supervision — need facts the OVSM does not carry, and are left
 * unanswered on purpose so the contract surfaces them.
 */
function deriveAxes(
  role: string,
  archetypeId: string,
  accountabilities: JobAccountability[],
  gates: string[],
  measures: string[],
  domains: string[],
): Partial<Record<JobDefinitionAxis, AxisAnswer>> {
  const axes: Partial<Record<JobDefinitionAxis, AxisAnswer>> = {};
  const stageLabels = accountabilities.map((a) => a.label).join("; ");

  axes.purpose = satisfied(
    `${role} is accountable for ${accountabilities.length} stage(s) of this business's operating `
    + `value stream: ${stageLabels}.`,
  );

  axes.accountabilities = satisfied(
    accountabilities
      .map((a) => `${a.label} (${a.trigger ?? "no declared trigger"} → ${a.outcome ?? "no declared outcome"})`)
      .join("; "),
  );

  if (measures.length > 0) {
    axes.measures = satisfied(
      `Measured by the metric bindings its stages carry: ${measures.join(", ")}.`,
    );
  }

  // Cadence is ROOM-owned (DI-81E47BDA59F1). The value stream can say whether
  // this role HAS standing work; it cannot say at what cadence a room drives it,
  // and asserting one here would re-create the per-coworker toggle that ruling
  // removed. So a standing role gets the fact, not the schedule.
  if (accountabilities.some((a) => a.standing)) {
    axes.cadence = satisfied(
      `Holds standing work — ${accountabilities.filter((a) => a.standing).length} load-bearing `
      + `stage(s). Cadence is carried by the room that drives them (DI-81E47BDA59F1), not by this role.`,
    );
  }

  axes.tailoring = satisfied(
    `Derived from archetype "${archetypeId}"'s own operating value stream, so this definition is `
    + `already specific to how this business runs rather than a generic role description.`,
  );

  // PRIMING. The context axis had no establishment input at all — it was the
  // operator's "priming" and the door never asked. It is derivable: a role must
  // know the constraints its own stages impose before it takes a turn, and the
  // domains those stages work in.
  //
  // The constraints carry the weight. A gate named `clinical-adjacent-no-advice`
  // or `regulated-no-advice` is not a checkbox to tick after the fact — it is
  // something the role has to hold BEFORE its first turn, or the first turn is
  // the incident. Measured across the live catalogue: 23 distinct gates, 394 of
  // 877 stages carrying a domain binding.
  if (gates.length > 0 || domains.length > 0) {
    const parts: string[] = [];
    if (gates.length > 0) {
      parts.push(`must hold these constraints before acting: ${gates.join(", ")}`);
    }
    if (domains.length > 0) {
      parts.push(`works in: ${domains.join(", ")}`);
    }
    axes.context = satisfied(
      `Derived from the stages ${role} owns — ${parts.join("; ")}. Its profession corpus supplies `
      + `the craft knowledge; this is the part specific to THIS business.`,
    );
  }

  // STILL DELIBERATELY UNANSWERED: authority (gates say what its work must PASS,
  // not what it may decide alone — that needs the FPAW §10 allocation pattern),
  // qualifications (tools and skills are platform facts, not value-stream
  // facts), and supervision. Guessing any of them would put a plausible
  // sentence where a decision belongs.

  return axes;
}

/**
 * Pure derivation: OVSM → job definitions, one per responsible role.
 * Deterministic and side-effect free, so it is asserted without a database.
 */
export function buildArchetypeJobDefinitions(
  ovsm: OperationalValueStream,
): ArchetypeJobDefinitionSet {
  const byRole = new Map<string, JobAccountability[]>();
  const unownedStageKeys: string[] = [];

  // Lane roles first: the lane owns its stages unless a stage names its own
  // owner. 100% of lanes declare a role against ~2% of stages, so resolving
  // lane-then-stage is the difference between deriving jobs and deriving none.
  const laneRoleByStageKey = new Map<string, string>();
  for (const lane of ovsm.streams ?? []) {
    const laneRole = lane.responsibleRole?.trim();
    if (!laneRole) continue;
    for (const laneStage of lane.stages ?? []) {
      laneRoleByStageKey.set(laneStage.key, laneRole);
    }
  }

  for (const stage of ovsm.stages) {
    // A stage that names its own owner overrides the lane it sits in: the more
    // specific declaration wins, which is also how the derive-with-override
    // family behaves everywhere else.
    const role = stage.responsibleRole?.trim() || laneRoleByStageKey.get(stage.key);
    if (!role) {
      unownedStageKeys.push(stage.key);
      continue;
    }
    const accountability: JobAccountability = {
      stageKey: stage.key,
      label: stage.label,
      streamKey: stage.streamKey,
      order: stage.order,
      trigger: stage.input,
      outcome: stage.output,
      standing: stage.loadBearing,
    };
    const existing = byRole.get(role);
    if (existing) existing.push(accountability);
    else byRole.set(role, [accountability]);
  }

  const definitions = [...byRole.entries()]
    .map(([role, accountabilities]): ArchetypeJobDefinition => {
      const ordered = [...accountabilities].sort((a, b) => a.order - b.order);
      const stagesByKey = new Map(ovsm.stages.map((s) => [s.key, s]));
      const gates = [
        ...new Set(ordered.flatMap((a) => stagesByKey.get(a.stageKey)?.trustGateKeys ?? [])),
      ].sort();
      const measures = [
        ...new Set(ordered.flatMap((a) => stagesByKey.get(a.stageKey)?.metricBindings ?? [])),
      ].sort();
      const streamKeys = [...new Set(ordered.map((a) => a.streamKey))].sort();
      const domains = [
        ...new Set(
          ordered.flatMap((a) =>
            (stagesByKey.get(a.stageKey)?.capabilityBindings ?? []).map((c) => String(c)),
          ),
        ),
      ].sort();

      return {
        definitionId: `archetype-job:${ovsm.archetypeId}:${role.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
        role,
        archetypeId: ovsm.archetypeId,
        streamKeys,
        accountabilities: ordered,
        gateBindings: gates,
        measureBindings: measures,
        hasStandingWork: ordered.some((a) => a.standing),
        requiredContext: { constraints: gates, domains },
        axes: deriveAxes(role, ovsm.archetypeId, ordered, gates, measures, domains),
      };
    })
    // Stable output: a projection whose order wobbles produces spurious diffs on
    // every re-projection, which is how convergence noise starts.
    .sort((a, b) => a.role.localeCompare(b.role));

  return {
    archetypeId: ovsm.archetypeId,
    archetypeName: ovsm.archetypeName,
    category: ovsm.category,
    definitions,
    unownedStageKeys: [...unownedStageKeys].sort(),
  };
}

/**
 * The axes a derived definition still needs a human (or the establishment door)
 * to answer. This is the worklist the projection hands over, and it is the
 * honest half of the design: the OVSM knows what this role is accountable for
 * and cannot know what tools it needs or who it reports to.
 */
export function unansweredAxesFor(definition: ArchetypeJobDefinition): JobDefinitionAxis[] {
  return JOB_DEFINITION_AXES.filter((axis) => !definition.axes[axis]);
}
