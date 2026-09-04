// What the ruling action says back to the owner (BI-3D0FB84B).
//
// Kept beside the lifecycle vocabulary rather than in the server action: these
// sentences describe lifecycle states ("someone already ruled", "recorded but
// not applied"), so they belong with the module that owns those states — and
// the copy stays reviewable in one place instead of scattered through a
// server action's error branches.

export const PROPOSAL_MESSAGES = {
  missing: "That suggestion no longer exists.",
  unknownAction: "That suggestion has an action this install does not know how to apply.",
  alreadyRuled: "Someone already ruled on this suggestion.",
  needsWording: "Add your wording before accepting it.",
  rejected: "Rejected. This suggestion will not come back.",
} as const;

/**
 * The honest failure sentence when the ruling was recorded but its write-through
 * did not land. It never invites a retry, because the proposal is already
 * settled — the owner needs to know what is now missing, not to press again.
 */
export function recordedButNotApplied(reason: string): string {
  return `Your ruling was recorded, but it could not be applied: ${reason}`;
}

/** Weight-adjustment refusals, surfaced from the existing weight-proposal path. */
export const WEIGHT_MISSING = "That weight adjustment no longer exists.";
export const WEIGHT_ALREADY_RULED = "Someone already ruled on that weight adjustment.";
export const NO_ORGANIZATION = "No organization is configured for this install.";
