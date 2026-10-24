/** Pure replay identity shared by the upgrade worker and operator projection. */
export const LANDED_SWAP_FALSE_FAILURE_REASON =
  "admission-reopened-before-swap: the drain already ended (completed)";

export function isLandedSwapFalseFailureReason(reason: string | null | undefined): boolean {
  return reason === LANDED_SWAP_FALSE_FAILURE_REASON;
}

/** Exact running-image identity; the ledger's deployedSha alone is only a plan. */
export function resumedSwapAlreadyLanded(input: {
  deployedSha: string | null | undefined;
  targetSha: string | null | undefined;
  currentSha: string | null | undefined;
}): boolean {
  if (!input.deployedSha || !input.targetSha || !input.currentSha) return false;
  const deployed = input.deployedSha.toLowerCase();
  return deployed === input.targetSha.toLowerCase() && deployed !== input.currentSha.toLowerCase();
}
