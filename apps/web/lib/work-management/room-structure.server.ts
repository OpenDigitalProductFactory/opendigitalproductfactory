/**
 * Server binding for Work Room structure (EP-WORKROOM-COMMS / EP-VSL-SURFACE fold).
 *
 * Fetches the room subject's stored stage/status with full prisma and folds it onto
 * the pure `resolveWorkroomStructure` resolver. Injected into the case loader as its
 * `structureLoader` so the loader keeps its narrow client and never touches the CRM
 * models directly.
 *
 * First slice resolves the OPPORTUNITY subject (a clean, direct source → subject
 * mapping). Account-backed sources (engagement/activity/booking → CustomerAccount) and
 * platform-development subjects are paved follow-ups: `workroomStructureSubjectFor`
 * already accepts an `accountStatus`, so wiring them is an additive resolver branch —
 * no contract change.
 */
import { prisma } from "@dpf/db";

import {
  resolveWorkroomStructure,
  workroomStructureSubjectFor,
  type WorkroomStructure,
} from "./room-structure";

/**
 * Resolve the value-stream + lifecycle structure for a room's subject from its source
 * ref. Returns null when the subject has no binding (or cannot be found).
 */
export async function resolveWorkroomStructureForCase(ref: {
  sourceType: string;
  sourceId: string;
}): Promise<WorkroomStructure | null> {
  if (ref.sourceType === "opportunity") {
    const opportunity = await prisma.opportunity.findFirst({
      where: { OR: [{ id: ref.sourceId }, { opportunityId: ref.sourceId }] },
      select: { stage: true },
    });
    return resolveWorkroomStructure(
      workroomStructureSubjectFor({ sourceType: ref.sourceType, opportunityStage: opportunity?.stage }),
    );
  }

  return null;
}
