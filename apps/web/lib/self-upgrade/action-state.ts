export const SELF_UPGRADE_ACTION_STATE = Object.freeze({
  UPDATE_AVAILABLE: "update-available",
  NO_UPDATE: "no-update",
  UNAVAILABLE: "unavailable",
} as const);

export type SelfUpgradeActionState =
  (typeof SELF_UPGRADE_ACTION_STATE)[keyof typeof SELF_UPGRADE_ACTION_STATE];

export function describeSelfUpgradeActionState(state: SelfUpgradeActionState): string {
  return state === SELF_UPGRADE_ACTION_STATE.UNAVAILABLE
    ? "Update status unavailable. Nothing queued."
    : "No update is ready.";
}
