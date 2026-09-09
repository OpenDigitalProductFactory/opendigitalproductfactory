// When a fail-closed pause may be retried (BI-WRITEBACK-LATCH).
//
// #5166 stopped a real defect: a stage that produced no completing receipt was
// re-dispatched every 15 minutes, burning model capacity on work that never
// completed. Pausing instead was right.
//
// The latch it introduced is self-sustaining, though — the pause reason is
// itself one of the conditions that causes the pause — so a room that enters
// this state never leaves it. On this install that locked 12 of 24 rooms, and
// they stayed locked after the executor defect was fixed and deployed: a fix
// cannot reach a room that will not try again.
//
// So the latch is bounded rather than permanent. It holds WITHIN a cycle and
// releases on the next one, giving one attempt per cycle — daily, for these
// shapes — instead of the 96 per day the guard was built to stop. The capacity
// protection is kept (a 96x reduction); the deadlock is not.

import { EXECUTOR_WRITEBACK_UNAVAILABLE_REASON } from "./workroom-drive-receipts";

export type PriorDriveForLatch = {
  action: string;
  reason: string;
  stageKey: string | null;
  /** The cycle the prior tick belonged to. Null when unknown. */
  cycleKey: string | null;
};

/**
 * Whether the writeback latch still holds for this stage.
 *
 * A recorded `blocked` receipt holds unconditionally: it is a durable statement
 * about this stage rather than an inference from the previous tick, and nothing
 * here should override it.
 *
 * An unknown cycle on either side holds too. Treating "unknown" as "a new cycle"
 * would silently re-open the every-tick loop the guard exists to prevent.
 */
export function writebackLatchHolds(input: {
  prior: PriorDriveForLatch | null;
  stageKey: string;
  currentCycleKey: string | null;
  blocked: boolean;
}): boolean {
  if (input.blocked) return true;
  const prior = input.prior;
  if (!prior) return false;
  if (prior.stageKey !== input.stageKey) return false;

  const triedWriteback =
    prior.action === "dispatch_agent" || prior.reason === EXECUTOR_WRITEBACK_UNAVAILABLE_REASON;
  if (!triedWriteback) return false;

  // Same cycle — or an unknown one — keeps the latch. A genuinely new cycle
  // releases it for exactly one fresh attempt.
  if (prior.cycleKey === null || input.currentCycleKey === null) return true;
  return prior.cycleKey === input.currentCycleKey;
}
