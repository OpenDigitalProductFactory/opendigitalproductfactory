import {
  WorkroomCycleError,
  selectCompletedWorkroomCycles,
  selectCurrentWorkroomCycle,
} from "./room-cycle";
import type { WorkroomCycleCarrierCandidate } from "./room-cycle";
import type { WorkroomCycleView } from "./room-types";
import { readDeclaredWorkShapeKey } from "./work-shapes";

/** Project a room's cycles, degrading to an explained gap rather than throwing.
 *
 *  Two rules live here together because they are the same lesson (BI-97B24FB5):
 *
 *  1. The room's DECLARED work shape can widen a finite source to standing. A
 *     standing room always holds an active carrier, so a source-only reading
 *     refuses the very rooms that are working correctly.
 *
 *  2. A cycle that cannot be projected costs the CYCLE, never the ROOM. The
 *     throw used to escape the server component, so a mis-projected cycle blanked
 *     the whole page and the operator lost the outcome, the owner and the
 *     activity too. Fail closed on the section, open on the page.
 */
export function projectRoomCycles(input: {
  sourceKey: string;
  sourceId: string;
  candidates: readonly WorkroomCycleCarrierCandidate[];
  scopeClaims: unknown;
  registered: boolean;
}): {
  currentCycle: WorkroomCycleView | null;
  completedCycles: WorkroomCycleView[];
  cycleProjectionError: string | null;
} {
  if (!input.registered) return { currentCycle: null, completedCycles: [], cycleProjectionError: null };

  const options = { declaredShapeKey: readDeclaredWorkShapeKey(input.scopeClaims) };
  try {
    return {
      currentCycle: selectCurrentWorkroomCycle(input.sourceKey, input.candidates, options),
      completedCycles: selectCompletedWorkroomCycles(input.sourceKey, input.candidates, options),
      cycleProjectionError: null,
    };
  } catch (error) {
    if (!(error instanceof WorkroomCycleError)) throw error;
    console.error(
      `[work-case] cycle projection failed for ${input.sourceKey}:${input.sourceId} — ${error.reason}: ${error.message}`,
    );
    return { currentCycle: null, completedCycles: [], cycleProjectionError: error.reason };
  }
}
