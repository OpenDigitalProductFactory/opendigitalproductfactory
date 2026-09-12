/**
 * NO WORK STOPS WITHOUT A CONCLUSION (BI-12A083B4, EP-C00F61F4).
 *
 * Founder, 2026-09-11: "I have found myself having to nudge things along by
 * asking this simple question repeatedly. If outcomes aren't met, continue or
 * surface what is blocking when you stop so we can address the blockage. This
 * is a recursively repeatable thing until the organization's stated objectives,
 * the very reason for its existence, is met."
 *
 * THE INVARIANT. A stop is legitimate in exactly three states:
 *   • the declared outcome is MET,
 *   • work CONTINUES, or
 *   • a BLOCKAGE is named, with an owner who can clear it and the observable
 *     event that would clear it.
 * Any fourth state is silence, and silence is what makes a person ask.
 *
 * WHAT THE DRIVE DID BEFORE THIS. Of the drive's terminal exits, four ended
 * with no owner and no unblocking event, and one says so in its own ledger line:
 * "Substrate unreachable; drive stopped and raised nothing." `missing_shape`,
 * `no_posture`, `unreachable_substrate` and `empty_read` all left a room
 * motionless and quiet. `conformance_stop` named its deviations but no
 * accountable, and an `attention` for an `unknown_principal` raised a hand at
 * nobody. A room in any of those states waits on no one, forever, and the only
 * thing that ever surfaced it was a human asking.
 *
 * THIS MODULE DOES NOT DECIDE WHETHER TO STOP. The drive already decides that,
 * from the work shape's own declared stages and stop conditions. This classifies
 * the stop the drive reached, so a stop that concluded nothing is recorded AS a
 * blockage rather than as quiet.
 *
 * FAIL CLOSED ON SILENCE. An action/reason pair this module does not recognise
 * returns `unconcluded` rather than assuming the best. A future drive exit that
 * forgets to conclude therefore shows up as a defect on its first tick, which is
 * the whole point: the invariant must hold for exits nobody has written yet.
 *
 * Pure and synchronous. The caller resolves accountability (that walk is already
 * a pure function) and passes the answer in.
 */
import type { EffectiveHumanAccountability } from "./human-accountability";

export const CONCLUSION_KINDS = [
  "outcome-met",
  "in-motion",
  "blocked",
  "unconcluded",
] as const;
export type ConclusionKind = (typeof CONCLUSION_KINDS)[number];

/** Every reason code the drive can reach, by the action that carries it. */
export const DRIVE_REASONS_BY_ACTION = Object.freeze({
  do_not_wake: ["missing_shape", "quiet", "no_posture"],
  stop: ["unreachable_substrate", "empty_read", "conformance_stop", "success"],
  escalate: ["conformance_escalate"],
  pause: ["conformance_pause"],
  attention: ["governed_decision", "role_stage", "person_stage", "unknown_principal"],
  dispatch_agent: ["agent_stage"],
} as const);

export type DriveConclusionBlockage = {
  /** What is blocked, in the words an owner would use. */
  what: string;
  /** The observable event that clears it. Never "someone looks at it". */
  unblockedBy: string;
  /** Resolved through the accountability lineage; null when it cannot be. */
  ownerPrincipalId: string | null;
  /** Why there is no owner, when there is none. This is a modelling defect. */
  ownerSetupRequired: string | null;
};

export type DriveConclusion = {
  kind: ConclusionKind;
  action: string;
  reason: string;
  blockage: DriveConclusionBlockage | null;
  /** One line an operator can read without opening the code. */
  summary: string;
};

/**
 * What each terminal reason means, and what would actually clear it.
 *
 * A blockage whose unblocking event is "someone reviews this" is not a
 * blockage, it is a shrug. Each entry names a condition a machine or a person
 * can observe having happened.
 */
const BLOCKAGES: Record<string, { what: string; unblockedBy: string }> = {
  missing_shape: {
    what: "This room declares no work shape, so nothing can wake it or say when it is done.",
    unblockedBy: "a work shape is declared on the room",
  },
  no_posture: {
    what: "No posture resolves for this room, so the drive cannot tell how hard to push or whether it may act.",
    unblockedBy: "the room declares a posture, or one derives from its shape",
  },
  unreachable_substrate: {
    what: "The substrate this room reads cannot be reached, so it has nothing to act on.",
    unblockedBy: "the substrate answers a read again",
  },
  empty_read: {
    what: "The substrate this room reads returned nothing, so there is no work to advance.",
    unblockedBy: "the substrate returns at least one item for this room",
  },
  conformance_stop: {
    what: "The room does not conform to its declared shape, so advancing it would break the shape's own rules.",
    unblockedBy: "the recorded conformance deviations are closed",
  },
  conformance_escalate: {
    what: "The room's shape requires a decision this room cannot make for itself.",
    unblockedBy: "the escalated decision is recorded",
  },
  conformance_pause: {
    what: "The room's shape paused it, so it is waiting rather than working.",
    unblockedBy: "the condition the shape paused on no longer holds",
  },
  unknown_principal: {
    what: "The room raised attention but names no one who can act on it, so it is waiting on nobody.",
    unblockedBy: "the stage names a principal who can act",
  },
};

/** Reasons that are legitimately not a stop at all. */
const IN_MOTION = new Set([
  "agent_stage",
  "governed_decision",
  "role_stage",
  "person_stage",
  // The posture asked this room not to interrupt. That is a cadence decision
  // the room made on purpose, not an unmet outcome nobody is carrying.
  "quiet",
]);

const OUTCOME_MET = new Set(["success"]);

export type DriveConclusionInput = {
  action: string;
  reason: string;
  /** Who the drive raised attention to, when it raised any. */
  attentionPrincipalRef?: string | null;
  /** The accountability walk's answer for this room. */
  accountability: EffectiveHumanAccountability;
};

export function resolveDriveConclusion(input: DriveConclusionInput): DriveConclusion {
  const { action, reason } = input;
  const base = { action, reason } as const;

  if (OUTCOME_MET.has(reason)) {
    return {
      ...base,
      kind: "outcome-met",
      blockage: null,
      summary: "The room reached its declared conclusion.",
    };
  }

  // An attention with no one to answer it is not motion, whatever it is
  // labelled. Check the principal before trusting the action.
  const raisedAtNobody = action === "attention" && !input.attentionPrincipalRef;
  if (IN_MOTION.has(reason) && !raisedAtNobody) {
    return {
      ...base,
      kind: "in-motion",
      blockage: null,
      summary:
        reason === "quiet"
          ? "The room's posture asked it not to interrupt; it stays on its cadence."
          : "Work is in motion.",
    };
  }

  const descriptor = BLOCKAGES[reason]
    ?? (raisedAtNobody ? BLOCKAGES.unknown_principal : null);

  if (!descriptor) {
    // Fail closed. An exit this module does not know is silence, and silence is
    // the thing being removed, so it is reported rather than assumed benign.
    return {
      ...base,
      kind: "unconcluded",
      blockage: null,
      summary:
        `The drive ended on ${action}/${reason}, which names no conclusion. `
        + "A stop must meet its outcome, continue, or name a blockage. Teach this reason one of the three.",
    };
  }

  const owner = input.accountability;
  if (owner.state !== "resolved") {
    return {
      ...base,
      kind: "unconcluded",
      blockage: {
        ...descriptor,
        ownerPrincipalId: null,
        ownerSetupRequired: owner.message,
      },
      summary: `${descriptor.what} No one can be named to clear it: ${owner.message}`,
    };
  }

  return {
    ...base,
    kind: "blocked",
    blockage: {
      ...descriptor,
      ownerPrincipalId: owner.principalId,
      ownerSetupRequired: null,
    },
    summary: `${descriptor.what} Cleared when ${descriptor.unblockedBy}.`,
  };
}

/**
 * Does this outcome need an owner resolved before it can be recorded?
 *
 * The drive ticks many rooms, and resolving accountability walks the room's
 * containment lineage. Only a blockage needs an owner, so this lets the caller
 * pay for that walk on the stops that are actually stuck and skip it entirely
 * for work in motion and for a room that finished.
 */
export function driveOutcomeNeedsOwner(input: {
  action: string;
  reason: string;
  attentionPrincipalRef?: string | null;
}): boolean {
  if (OUTCOME_MET.has(input.reason)) return false;
  const raisedAtNobody = input.action === "attention" && !input.attentionPrincipalRef;
  if (IN_MOTION.has(input.reason) && !raisedAtNobody) return false;
  return true;
}

/** Every action/reason pair the drive can produce. Used by the conformance walk. */
export function everyDriveOutcome(): Array<{ action: string; reason: string }> {
  return Object.entries(DRIVE_REASONS_BY_ACTION).flatMap(([action, reasons]) =>
    reasons.map((reason) => ({ action, reason })),
  );
}
