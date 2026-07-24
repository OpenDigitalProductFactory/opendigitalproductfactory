// apps/web/lib/self-upgrade/is-expected-during-swap.ts
//
// A forced upgrade (or a recovery-point rollback) intentionally bypasses the
// quiescence drain and restarts services, swapping the portal container out
// from under the very request that triggered it. When the swap lands
// mid-flight, the operator's own server-action response never returns intact
// — Next surfaces a non-RSC transport failure ("An unexpected response was
// received from the server", error code E394), or the browser reports a bare
// network error. For self-upgrade surfaces that is the EXPECTED success path
// of a swap, not a crash.
//
// Shared (BI-D77BF495) by SelfUpgradeTriggerControl (trigger / force / abort)
// and SelfUpgradeClient (rollback) so both hold the same calm "reconnecting"
// state instead of letting the rejection escalate to the global (shell)
// error boundary and paint a full-page "Something went wrong" over an
// upgrade that actually succeeded.

import { getErrorMessage } from "@/lib/shared/get-error-message";

export function isExpectedDuringSwap(err: unknown): boolean {
  if (!err) return false;
  // Next stamps server-action transport failures with a stable error code.
  const code = (err as { __NEXT_ERROR_CODE?: unknown }).__NEXT_ERROR_CODE;
  if (code === "E394") return true;
  const message = getErrorMessage(err);
  return /unexpected response was received|failed to fetch|fetch failed|load failed|networkerror|err_connection|connection (?:refused|reset|closed)|the operation was aborted/i.test(
    message,
  );
}
