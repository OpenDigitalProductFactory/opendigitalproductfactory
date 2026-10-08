// Who owns a drive conclusion that needs an owner, and the fallback answers when
// that cannot be read. Split out of workroom-drive.ts to keep it under the
// module-size ceiling; behaviour is unchanged.

import type { EffectiveHumanAccountability } from "@/lib/work-management/human-accountability";

/**
 * The answer when nobody was asked, because the tick did not need an owner.
 * Never reaches a recorded blockage: driveOutcomeNeedsOwner gates the call.
 */
export const NOT_ASKED_ACCOUNTABILITY: EffectiveHumanAccountability = {
  state: "setup-required",
  reason: "no-organization-owner-recorded",
  message: "Accountability was not resolved because this tick needed no owner.",
  atWorkroomId: null,
};

export async function resolveAccountabilityForConclusion(
  roomId: string,
  resolveAccountability: ((roomId: string) => Promise<EffectiveHumanAccountability>) | undefined,
): Promise<EffectiveHumanAccountability> {
  if (!resolveAccountability) {
    return {
      state: "setup-required",
      reason: "no-organization-owner-recorded",
      message:
        "This drive was composed without an accountability resolver, so no owner could be named. "
        + "Wire resolveAccountability into the drive's effects.",
      atWorkroomId: roomId,
    };
  }
  try {
    return await resolveAccountability(roomId);
  } catch (error) {
    // A failed lookup must not swallow the blockage. Record that the owner is
    // unknown and why, which is still louder than stopping silently.
    return {
      state: "setup-required",
      reason: "no-organization-owner-recorded",
      message: `Accountability could not be read: ${error instanceof Error ? error.message : String(error)}`,
      atWorkroomId: roomId,
    };
  }
}
