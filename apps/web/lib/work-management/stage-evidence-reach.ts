// What the drive will do with stage evidence just recorded (BI-C9912C22 AC-3).
//
// record_workroom_evidence used to answer "Recorded evidence" whatever the
// drive would make of it, so an author on WC-BFDF763B recorded completed
// reproduce evidence and the room then sat 88 ticks on the same stage with no
// word why. The drive still owns the advance (stage-evidence-receipts.ts); this
// only reads the room's stored drive snapshot and says whether the next tick
// can earn the stage's receipt from this evidence, or why it cannot.
//
// Pure: reads the supplied workspaceState only.

import { isRecord } from "@/lib/shared/coerce";

export type StageEvidenceReach = {
  willAdvance: boolean;
  reason: "readable" | "blocked_outcome" | "not_current_stage" | "accountable_elsewhere" | "no_driven_stage";
  message: string;
};

/** The author's own stage: the one principal whose evidence starts its stage. */
const AUTHOR_PRINCIPAL = "role:author";

export function describeStageEvidenceReach(
  workspaceState: unknown,
  evidence: { stageKey: string | null; outcome: string | null },
): StageEvidenceReach | null {
  const { stageKey } = evidence;
  if (!stageKey) return null;
  if (evidence.outcome !== "completed") {
    return { willAdvance: false, reason: "blocked_outcome", message: `Recorded as a blocker on stage ${stageKey}; a blocker never advances a stage.` };
  }
  const drive = isRecord(workspaceState) && isRecord(workspaceState.workroomDrive) ? workspaceState.workroomDrive : null;
  // Graph rooms keep a marking with several live stages; the drive matches
  // evidence to its marked stages itself.
  if (drive && isRecord(drive.marking)) {
    return { willAdvance: true, reason: "readable", message: `The drive reads this on its next tick if ${stageKey} is a marked stage and the kind is one it declared.` };
  }
  const current = drive && typeof drive.stageKey === "string" ? drive.stageKey : null;
  if (!current) {
    return { willAdvance: false, reason: "no_driven_stage", message: `The drive has not placed this room on a stage yet, so ${stageKey} cannot advance from this evidence.` };
  }
  if (current !== stageKey) {
    return {
      willAdvance: false, reason: "not_current_stage",
      message: `Stage ${stageKey} is not this room's current stage (${current}); the drive reads evidence only for its current stage.`,
    };
  }
  const pending = isRecord(drive?.pendingAttention) ? drive.pendingAttention : null;
  const waitingOn = pending && pending.stageKey === stageKey && typeof pending.principalRef === "string" ? pending.principalRef : null;
  if (waitingOn && (pending?.reason === "person_stage" || (pending?.reason === "role_stage" && waitingOn !== AUTHOR_PRINCIPAL))) {
    return {
      willAdvance: false, reason: "accountable_elsewhere",
      message: `Stage ${stageKey} is accountable to ${waitingOn}; evidence recorded here does not advance it. ${waitingOn} records that stage's outcome.`,
    };
  }
  return {
    willAdvance: true, reason: "readable",
    message: `The next drive tick advances stage ${stageKey} if the evidence kind is one the stage declared and it post-dates the stage's start.`,
  };
}
