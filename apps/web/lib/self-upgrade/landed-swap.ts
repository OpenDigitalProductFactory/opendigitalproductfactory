/**
 * Identity of a self-upgrade whose swap already landed and whose ledger was
 * then marked failed by the retried swap step. SUR-6D9543E6, SUR-8F1389F9.
 *
 * The drain guard's error is "the drain already ended (completed)". That drain
 * ended because boot reconciliation closed it after the new portal came up on
 * the target, not because admission reopened.
 */
export const LANDED_SWAP_FALSE_FAILURE_REASON =
  "admission-reopened-before-swap: the drain already ended (completed)";

/**
 * The retried swap step is running inside the portal the promoter just booted.
 * That image's identity is the target, and the run's currentSha is still the
 * pre-swap image. False when the running identity is still the pre-swap SHA.
 */
export function resumedSwapAlreadyLanded(input: {
  deployedSha: string | null | undefined;
  targetSha: string | null | undefined;
  currentSha: string | null | undefined;
}): boolean {
  if (!input.deployedSha || !input.targetSha || !input.currentSha) return false;
  const deployed = input.deployedSha.toLowerCase();
  return deployed === input.targetSha.toLowerCase() && deployed !== input.currentSha.toLowerCase();
}
