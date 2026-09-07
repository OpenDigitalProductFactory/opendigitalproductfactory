// A completed stage earns a receipt, and a receipt is what advances the shape
// (BI-76B35820).
//
// `nextStageKey` advances only when the current stage has a receipt. Receipts
// were READ in three places and WRITTEN in none — always `[]`, so every room
// re-dispatched stage one on every tick, forever. Twelve rooms did that at a
// 15-minute cadence: WC-A69BCABB ran `sweep` five times and never reached
// `raise` or `decide`.
//
// It also looked healthy. `action: dispatch_agent` reads as success on every
// surface; only the stage histogram showed the loop.
//
// This is the eleventh read-with-no-writer in this program, so the correlation
// key gets a single builder used by BOTH the dispatch and the lookup — writer
// and reader drift is the exact failure this keeps taking.

/** The ScheduledAgentTask/TaskRun title for a room's stage.
 *
 *  The ONLY correlation between a dispatch and its completed run. Used by the
 *  dispatcher when it creates the task and by the receipt reader when it looks
 *  for completion; if these two ever disagree, stages silently stop advancing
 *  again. One function, two callers, no drift. */
export function workroomStageTaskTitle(capsuleId: string, stageKey: string): string {
  return `Workroom ${capsuleId} / ${stageKey}`;
}

export type StageReceipt = {
  stageKey: string;
  kind: string;
};

export type CompletedRun = {
  title: string;
  status: string;
};

/** Receipt kind recorded when a dispatched stage's own task run completes. */
export const STAGE_COMPLETION_RECEIPT_KIND = "stage-run-completed";

/**
 * Whether the room's current stage has now earned a receipt.
 *
 * ONLY a completed run earns one. A failed or still-working run earns nothing,
 * so the stage stays current and is re-dispatched next tick — which is the
 * correct retry, and keeps a failure from being laundered into progress.
 */
export function stageRunCompleted(input: {
  capsuleId: string;
  currentStageKey: string | null;
  runs: readonly CompletedRun[];
}): boolean {
  if (!input.currentStageKey) return false;
  const title = workroomStageTaskTitle(input.capsuleId, input.currentStageKey);
  return input.runs.some((run) => run.title === title && run.status === "completed");
}

/**
 * The room's receipts after this tick's observation.
 *
 * Idempotent: a stage that already holds a receipt does not gain a second.
 * Returns the SAME array reference when nothing changed, so a caller can cheaply
 * tell whether a write is needed.
 */
export function earnStageReceipts(input: {
  capsuleId: string;
  currentStageKey: string | null;
  runs: readonly CompletedRun[];
  existing: readonly StageReceipt[];
}): readonly StageReceipt[] {
  if (!input.currentStageKey) return input.existing;
  if (input.existing.some((receipt) => receipt.stageKey === input.currentStageKey)) {
    return input.existing;
  }
  if (!stageRunCompleted(input)) return input.existing;
  return [
    ...input.existing,
    { stageKey: input.currentStageKey, kind: STAGE_COMPLETION_RECEIPT_KIND },
  ];
}

/**
 * Receipts carried into the next tick.
 *
 * A cycle is one pass through the shape. When the cycle rolls over the room
 * starts its stages again, so last cycle's receipts must not satisfy this
 * cycle's stages — otherwise a daily watch would run once and then skip every
 * stage forever, which is the same defect inverted.
 *
 * ⟦runtime: at the exact tick a cycle rolls over, resolution has already run
 * against the previous cycle's receipts, so a room can advance one stage early
 * at the boundary. Bounded and self-correcting (the next tick resolves against
 * the cleared set); noted rather than gold-plated because the alternative is
 * deriving the cycle key in a second place — BI-76B35820⟧
 */
export function carryReceipts(input: {
  receipts: readonly StageReceipt[];
  previousCycleKey: string | null;
  currentCycleKey: string | null;
}): readonly StageReceipt[] {
  if (input.currentCycleKey === null) return input.receipts;
  if (input.previousCycleKey === null) return input.receipts;
  return input.currentCycleKey === input.previousCycleKey ? input.receipts : [];
}
