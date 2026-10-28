/**
 * Server binding for Work Room structure (EP-WORKROOM-COMMS / EP-VSL-SURFACE fold).
 *
 * Fetches the room subject's stored stage/status with full prisma and folds it onto
 * the pure `resolveWorkroomStructure` resolver. Injected into the case loader as its
 * `structureLoader` so the loader keeps its narrow client and never touches the CRM
 * models directly.
 *
 * Resolves the OPPORTUNITY subject and, for backlog-item and work-capsule rooms, the
 * platform delivery subject: the IT4IT stage the room's current work-shape stage sits
 * at (BI-B8B3FB70). Account-backed sources (engagement/activity/booking →
 * CustomerAccount) remain a paved follow-up: `workroomStructureSubjectFor` already
 * accepts an `accountStatus`, so wiring them is an additive resolver branch.
 */
import { prisma } from "@dpf/db";

import {
  resolveWorkroomStructure,
  workroomStructureSubjectFor,
  type It4itStageDescriptor,
  type WorkroomStructure,
} from "./room-structure";
import { IT4IT_REFERENCE_MODEL_SLUG, it4itStageRefFor } from "./workroom-stage-it4it";
import { readDriveObservation } from "./workroom-stage-telemetry";
import { readWorkShapeClaimRef } from "./workroom-shape-claim";

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

  if (ref.sourceType === "backlog-item" || ref.sourceType === "work-capsule") {
    return resolveWorkroomStructure(
      workroomStructureSubjectFor({ sourceType: ref.sourceType, deliveryStage: await deliveryStageFor(ref) }),
    );
  }

  return null;
}

/**
 * The IT4IT stage a delivery room stands at: the room's current work-shape stage,
 * mapped through WORK_SHAPE_STAGE_IT4IT and named by the reference model. Null when
 * the room has no shape stage yet, the stage has no IT4IT binding, or the model is
 * not seeded; never a guessed stage.
 */
async function deliveryStageFor(ref: { sourceType: string; sourceId: string }): Promise<It4itStageDescriptor | null> {
  let where: { capsuleId: string } | { backlogItemId: { in: string[] } };
  if (ref.sourceType === "work-capsule") {
    where = { capsuleId: ref.sourceId };
  } else {
    // Build Studio rooms store the item's row id, CLI rooms its itemId (BI-62FB6505).
    const item = await prisma.backlogItem.findFirst({ where: { itemId: ref.sourceId }, select: { id: true } });
    where = { backlogItemId: { in: [ref.sourceId, ...(item ? [item.id] : [])] } };
  }
  const room = await prisma.workroom.findFirst({
    where,
    orderBy: { updatedAt: "desc" },
    select: { scopeClaims: true, workspaceState: true },
  });
  if (!room) return null;
  const participationReference = it4itStageRefFor(
    readWorkShapeClaimRef(room.scopeClaims),
    readDriveObservation(room.workspaceState)?.stageKey ?? null,
  );
  if (!participationReference) return null;
  const element = await prisma.eaReferenceModelElement.findFirst({
    where: {
      kind: "value_stream_stage",
      model: { slug: IT4IT_REFERENCE_MODEL_SLUG },
      properties: { path: ["participationReference"], equals: participationReference },
    },
    select: { name: true, parent: { select: { name: true } } },
  });
  if (!element?.parent) return null;
  return { participationReference, stageName: element.name, streamName: element.parent.name };
}
