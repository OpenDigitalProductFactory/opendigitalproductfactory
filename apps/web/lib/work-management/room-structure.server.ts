/**
 * Server binding for Work Room structure (EP-WORKROOM-COMMS / EP-VSL-SURFACE fold).
 *
 * Fetches the room subject's stored stage/status with full prisma and folds it onto
 * the pure `resolveWorkRoomStructure` resolver. Injected into the case loader as its
 * `structureLoader` so the loader keeps its narrow client and never touches the CRM
 * models directly.
 *
 * First slice resolves the OPPORTUNITY subject (a clean, direct source → subject
 * mapping). Account-backed sources (engagement/activity/booking → CustomerAccount) and
 * platform-development subjects are paved follow-ups: `workRoomStructureSubjectFor`
 * already accepts an `accountStatus`, so wiring them is an additive resolver branch —
 * no contract change.
 */
import { prisma } from "@dpf/db";

import {
  resolveWorkRoomStructure,
  workRoomStructureSubjectFor,
  type WorkRoomStructure,
} from "./room-structure";

/**
 * Resolve the value-stream + lifecycle structure for a room's subject from its source
 * ref. Returns null when the subject has no binding (or cannot be found).
 */
export async function resolveWorkRoomStructureForCase(ref: {
  sourceType: string;
  sourceId: string;
}): Promise<WorkRoomStructure | null> {
  if (ref.sourceType === "opportunity") {
    const opportunity = await prisma.opportunity.findFirst({
      where: { OR: [{ id: ref.sourceId }, { opportunityId: ref.sourceId }] },
      select: { stage: true },
    });
    return resolveWorkRoomStructure(
      workRoomStructureSubjectFor({ sourceType: ref.sourceType, opportunityStage: opportunity?.stage }),
    );
  }

  return null;
}
