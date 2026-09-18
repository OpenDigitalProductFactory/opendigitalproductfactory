// Coworker job definition — the nine axes a role must answer before it works.
//
// WHY THIS EXISTS. The factory door (establish_coworker) asks whether a coworker
// is correctly WIRED. It never asks whether it has a JOB. Its checklist makes a
// roster entry, a grants entry, a route binding, a model-floor row and a
// profession-family mapping mandatory — all plumbing — and then says, verbatim:
//
//     "Optionally: curated golden journey, service-catalog offer,
//      COWORKER_SELF_TASKS entry."
//
// All eight LIFE-0xx conformance axes are referential integrity: grants present,
// grants honored, route reachable, persona real, model floor present and real,
// wildcard skill reaches the roster, and existing self-tasks name real
// coworkers. LIFE-009 checks that a self-task which EXISTS names a real
// coworker. Nothing checks that a coworker HAS one.
//
// That is why the measure keeps finding what the door keeps permitting: 52
// coworkers with no cadence, 39 with no shape, 39 with no evidence. Closing them
// by hand works and does not stop new ones arriving.
//
// The operator's framing is the design: nobody hires by completing payroll,
// badge and desk assignment while leaving "what is this job, what does good look
// like, when do they work, what must they know" as optional.
//
// WHAT THIS MODULE IS. The contract only — the nine axes, and the vocabulary for
// answering each one either SATISFIED or WAIVED. It deliberately does not grade:
// capability-completeness.ts is and stays the grader, and these axes are its
// seven planes plus supervision and archetype tailoring. A second completeness
// model would be a second home for a rule already stated.
//
// A WAIVER IS NOT A BLANK. It carries a reason a person can disagree with and a
// reviewBy date, and the guard fails the build once that date passes. This is
// deliberately the same discipline as `staffing_posture`: the platform should
// have exactly one way of saying "not done, on purpose, revisit then".
//
// Design: docs/superpowers/specs/2026-09-16-coworker-job-definition-and-establishment-contract-design.md

/**
 * The nine axes. Eight already have canonical homes in the platform; the ninth
 * (archetype/local tailoring) is derived, not authored — see the spec §4.
 */
export const JOB_DEFINITION_AXES = [
  /** Why the role exists. Home: `capability_domain` on the registry entry. */
  "purpose",
  /** Outcomes owned. Home: WorkShapeDefinition stages, gates, stop conditions. */
  "accountabilities",
  /**
   * What it may decide alone, and what escalates. Home: tool grants plus the
   * FPAW §10 allocation pattern, which is what actually says where the human/AI
   * boundary falls for this role.
   */
  "authority",
  /**
   * When it works without being asked. Home: room posture — cadence is
   * ROOM-OWNED per DI-81E47BDA59F1, so this axis is satisfied by the room that
   * carries the drive, never by a per-coworker toggle.
   */
  "cadence",
  /** Skills, tools, model floor. Home: skill assignments + grants + floor. */
  "qualifications",
  /**
   * What it must KNOW. Home: corpus / WSID. This is the operator's "priming",
   * and it is the axis with no establishment input at all today.
   */
  "context",
  /** How anyone would know it is doing the job. Home: certification, measures. */
  "measures",
  /** Who it answers to. Home: `escalates_to` / `human_supervisor_id`. */
  "supervision",
  /**
   * How this role differs on THIS install. Derived from the org's Operational
   * Value Stream Model rather than authored per archetype — the same OVSM that
   * already projects the EA canvas and room definitions.
   */
  "tailoring",
] as const;
export type JobDefinitionAxis = (typeof JOB_DEFINITION_AXES)[number];

/** How an axis is answered. Unanswered is not a state — that is the point. */
export type AxisAnswer =
  | { state: "satisfied"; evidence: string }
  | { state: "waived"; reason: string; reviewBy: string };

export type CoworkerJobDefinition = {
  agentId: string;
  axes: Partial<Record<JobDefinitionAxis, AxisAnswer>>;
};

/** Minimum characters of reason or evidence. Long enough to be a sentence. */
const MIN_JUSTIFICATION = 40;

export type JobDefinitionProblem = {
  axis: JobDefinitionAxis;
  code: "unanswered" | "thin-justification" | "unparseable-review-date" | "expired-waiver";
  detail: string;
};

/**
 * Every axis the definition has not answered at all.
 *
 * Separated from the other problems because it is the one this whole contract
 * exists to surface: the door's failure was never a bad answer, it was no
 * question.
 */
export function unansweredAxes(def: CoworkerJobDefinition): JobDefinitionAxis[] {
  return JOB_DEFINITION_AXES.filter((axis) => !def.axes[axis]);
}

/**
 * Validate a definition. Returns every problem rather than the first, so an
 * author fixes one round of findings instead of peeling them one at a time.
 *
 * `now` is injected so the expiry rule is testable without waiting for a date.
 */
export function validateJobDefinition(
  def: CoworkerJobDefinition,
  now: Date = new Date(),
): JobDefinitionProblem[] {
  const problems: JobDefinitionProblem[] = [];

  for (const axis of JOB_DEFINITION_AXES) {
    const answer = def.axes[axis];
    if (!answer) {
      problems.push({
        axis,
        code: "unanswered",
        detail: `${axis} is unanswered — satisfy it, or waive it with a reason and a review date.`,
      });
      continue;
    }

    if (answer.state === "satisfied") {
      if (answer.evidence.trim().length < MIN_JUSTIFICATION) {
        problems.push({
          axis,
          code: "thin-justification",
          detail: `${axis} claims satisfied with ${answer.evidence.trim().length} characters of evidence; name what satisfies it.`,
        });
      }
      continue;
    }

    if (answer.reason.trim().length < MIN_JUSTIFICATION) {
      problems.push({
        axis,
        code: "thin-justification",
        detail: `${axis} is waived with ${answer.reason.trim().length} characters of reason; a waiver a reader cannot disagree with is a blank.`,
      });
    }

    const due = new Date(answer.reviewBy).getTime();
    if (Number.isNaN(due)) {
      problems.push({
        axis,
        code: "unparseable-review-date",
        detail: `${axis} waiver has an unparseable reviewBy (${answer.reviewBy}).`,
      });
      continue;
    }
    if (due <= now.getTime()) {
      // The load-bearing rule. When this fires the answer is to re-decide the
      // axis, NOT to push the date out because the build is red. A waiver that
      // renews itself is a permanent fiction.
      problems.push({
        axis,
        code: "expired-waiver",
        detail: `${axis} waiver expired on ${answer.reviewBy} — re-decide it rather than extending it.`,
      });
    }
  }

  return problems;
}

/** True when nothing is unanswered, thin, or expired. */
export function isJobDefinitionComplete(
  def: CoworkerJobDefinition,
  now: Date = new Date(),
): boolean {
  return validateJobDefinition(def, now).length === 0;
}

/**
 * The seven planes the capability measure grades, mapped to the axes that carry
 * them. Exported so a guard can assert the two models stay aligned: this
 * contract must remain the measure's planes plus supervision and tailoring, not
 * a second opinion about what completeness means.
 */
export const AXIS_TO_CAPABILITY_PLANE: Readonly<
  Partial<Record<JobDefinitionAxis, string>>
> = {
  purpose: "identity",
  accountabilities: "shape",
  authority: "governance",
  cadence: "cadence",
  qualifications: "toolsAndSkills",
  context: "corpus",
  measures: "evidence",
  // supervision and tailoring have no plane: the measure grades a coworker's
  // capability, and these two are facts about its PLACE — who it answers to and
  // which install it is on.
};
