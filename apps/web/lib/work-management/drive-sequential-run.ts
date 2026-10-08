// A sequential room's receipts belong to the run that earned them
// (BI-853120EE). Graph rooms scope theirs through the marking's run key
// (BI-086DC167); this is the same rule for the sequential drive, with the same
// receipt field (`runKey`) and the same membership test (`receiptInRun`).
//
// The defect it closes: the drive carried every receipt into every snapshot,
// and a success stores no stage. So the next cycle's run started at stage 1
// and walked the previous run's receipts. The agent stage advanced on
// yesterday's evidence and the governed stage completed on yesterday's
// decision, with no person deciding.
//
// A run starts on the first tick after the previous run concluded (success,
// or sleeping on a concluded run; runConcluded), on a different cycle key,
// and only for a shape that recurs (WWMD DI-8DCB9A4B566C: a claim-triggered
// room's successful run is final). It lasts until it concludes. It does not
// end at UTC midnight: a run in flight across the boundary keeps its receipts.
//
// Pure.

import { hasStoredDriveMarking } from "./drive-graph-tick";
import { usesGraphConstructs } from "./drive-marking";
import { projectDriveCycle, runConcluded } from "./drive-plan-stage";
import type { StageReceipt } from "./stage-evidence-receipts";
import {
  readWorkShapeDefinitionContract,
  workShapeRecurs,
  type WorkShapeDefinition,
  type WorkShapeDefinitionContract,
} from "./work-shapes";
import { receiptInRun, type PriorWorkroomDrive } from "./workroom-drive-receipts";
import { driveRunKeyOf } from "./workroom-drive-state";

export type SequentialRun = {
  /** The run this tick belongs to: the cycle key of the tick it started on. */
  runKey: string;
  /** This tick starts the run. */
  newRun: boolean;
  /** The run's receipts, each carrying `runKey`. Empty when the run is new. */
  receipts: StageReceipt[];
};

/**
 * The run a sequential room is on this tick, and the receipts that belong to it.
 *
 * - A new run (the prior tick concluded a run on another cycle key, and the
 *   shape recurs) is keyed by this tick's cycle key and starts with no
 *   receipts: every stage is earned again, every decision is made again.
 * - Otherwise the stored run continues. A snapshot written before run keys
 *   existed adopts `lastCycleKey` (else this cycle key) and keeps its
 *   receipts; that is the room in flight at deploy. A receipt of another run
 *   is dropped. Every kept receipt is stamped with the run key, `blocked`
 *   ones included.
 *
 * At most one run starts per cycle key: a run that concluded on this cycle
 * key is asleep (cycleCompleted), not restarted.
 */
export function resolveSequentialRun(input: {
  definition: Pick<WorkShapeDefinitionContract, "triggers">;
  cycleKey: string;
  workspaceState: unknown;
  prior: PriorWorkroomDrive | null;
  receipts: readonly StageReceipt[];
}): SequentialRun {
  const { prior, cycleKey } = input;
  const newRun = !!prior && runConcluded(prior) && prior.cycleKey !== cycleKey && workShapeRecurs(input.definition);
  if (newRun) return { runKey: cycleKey, newRun: true, receipts: [] };
  const drive = input.workspaceState && typeof input.workspaceState === "object"
    ? (input.workspaceState as Record<string, unknown>).workroomDrive
    : null;
  const runKey = driveRunKeyOf(drive) ?? prior?.cycleKey ?? cycleKey;
  // Stamping can make a legacy receipt identical to one the run already holds; keep the first.
  const seen = new Set<string>();
  const receipts: StageReceipt[] = [];
  for (const receipt of input.receipts) {
    if (!receiptInRun(receipt, runKey)) continue;
    const stamped = receipt.runKey === runKey ? receipt : { ...receipt, runKey };
    const key = JSON.stringify([stamped.stageKey, stamped.kind, stamped.iteration ?? 0]);
    if (seen.has(key)) continue;
    seen.add(key);
    receipts.push(stamped);
  }
  return { runKey, newRun: false, receipts };
}

/**
 * The run a room is on this tick, as the drive runner asks for it: null for a
 * graph room (its marking carries its run, BI-086DC167) and for a room with no
 * run key and no resolvable shape. A room whose shape does not resolve this
 * tick keeps the run key it has, so it is not taken for a new run when the
 * shape resolves again.
 */
export function sequentialRunFor(input: {
  shape: WorkShapeDefinition | null;
  workspaceState: unknown;
  now: Date;
  prior: PriorWorkroomDrive | null;
  receipts: readonly StageReceipt[];
}): SequentialRun | null {
  if (hasStoredDriveMarking(input.workspaceState)) return null;
  const definition = input.shape ? readWorkShapeDefinitionContract(input.shape) : null;
  if (!definition) {
    const drive = input.workspaceState && typeof input.workspaceState === "object"
      ? (input.workspaceState as Record<string, unknown>).workroomDrive
      : null;
    const kept = driveRunKeyOf(drive);
    return kept ? { runKey: kept, newRun: false, receipts: [...input.receipts] } : null;
  }
  if (usesGraphConstructs(definition)) return null;
  const cycleKey = projectDriveCycle({ now: input.now, collaborationShape: input.shape?.collaborationShape ?? null }, definition).cycleKey;
  return resolveSequentialRun({ definition, cycleKey, workspaceState: input.workspaceState, prior: input.prior, receipts: input.receipts });
}
