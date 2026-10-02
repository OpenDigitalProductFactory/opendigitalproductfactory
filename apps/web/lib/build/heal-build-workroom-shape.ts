// apps/web/lib/build/heal-build-workroom-shape.ts
//
// BI-C60EB507: initiative readiness gates a build by the delivery shape bound
// to its Workroom (small/medium never owe a plan document). A build with no
// Workroom, or a room with no workShape claim, falls to the unshaped v2 gate
// table and is refused at plan→build with PLAN_REQUIRED — a committed
// docs/superpowers/plans document the automated lane never produces. On the
// reference install 2026-09-23: 83 plan-phase builds had no room at all
// (decomposition children are created without one) and one room had no
// shape. Heal on the resume path: attach the room (which binds the shape from
// the originating item, the same code promotion uses) or bind the missing
// shape on the existing room. Idempotent; fixed forward at decomposition in
// approve-decomposition.ts.

import { readWorkShapeClaim } from "@/lib/work-management/workroom-shape-claim";

export type HealBuildWorkroomShapeResult = { healed: boolean; detail: string };

export async function healBuildWorkroomShape(input: {
  buildId: string;
  /** Actor for a newly attached room; the build's creator when it has one. */
  userId: string;
}): Promise<HealBuildWorkroomShapeResult> {
  const { prisma } = await import("@dpf/db");
  const build = await prisma.featureBuild.findUnique({
    where: { buildId: input.buildId },
    select: {
      id: true,
      buildId: true,
      title: true,
      description: true,
      phase: true,
      createdById: true,
      originator: {
        select: { id: true, itemId: true, title: true, body: true, epicId: true, taxonomyNodeId: true, effortSize: true, workType: true },
      },
    },
  });
  if (!build) return { healed: false, detail: "build not found" };
  if (!build.originator) return { healed: false, detail: "build has no governed backlog subject" };

  const backlogItem = {
    id: build.originator.id,
    itemId: build.originator.itemId,
    title: build.originator.title,
    body: build.originator.body,
    epicId: build.originator.epicId,
    taxonomyNodeId: build.originator.taxonomyNodeId,
    effortSize: build.originator.effortSize,
    workType: build.originator.workType,
  };
  const { attachBuildStudioWorkCapsule, bindBuildStudioDeliveryShape } = await import(
    "@/lib/work-capsules/build-studio-attachment"
  );
  type Db = Parameters<typeof attachBuildStudioWorkCapsule>[0]["db"];

  const room = await prisma.workroom.findFirst({
    where: { executorKind: "build-studio", executorRef: build.buildId },
    orderBy: { createdAt: "desc" },
    select: { id: true, capsuleId: true, scopeClaims: true },
  });
  if (!room) {
    const capsule = await attachBuildStudioWorkCapsule({
      db: prisma as unknown as Db,
      build: { id: build.id, buildId: build.buildId, title: build.title, description: build.description, phase: build.phase },
      backlogItem,
      actor: { userId: build.createdById ?? input.userId, agentId: null, principalId: null },
    });
    return { healed: true, detail: `attached Workroom ${capsule.capsuleId} and bound its delivery shape from ${backlogItem.itemId}` };
  }
  // An existing room may predate coworker admission (BI-00588B51): without it
  // the room's participant term narrows the build's own coworkers to reads.
  let coworkerDetail = "";
  let coworkersAdmitted = false;
  try {
    const { admitBuildStudioRoomCoworkers, describeBuildStudioRoomCoworkers } = await import(
      "@/lib/work-capsules/build-studio-room-coworkers"
    );
    const admitted = await admitBuildStudioRoomCoworkers({ db: prisma as never, workroomId: room.id });
    const described = describeBuildStudioRoomCoworkers(admitted);
    if (described) coworkerDetail = ` ${described}`;
    coworkersAdmitted = admitted.admitted.length > 0;
  } catch (err) {
    coworkerDetail = ` Coworker admission failed: ${(err as Error)?.message?.slice(0, 160) ?? "unknown error"}`;
  }
  if (readWorkShapeClaim(room.scopeClaims)) {
    return coworkersAdmitted
      ? { healed: true, detail: `delivery shape already bound on ${room.capsuleId}.${coworkerDetail}` }
      : { healed: false, detail: `delivery shape already bound${coworkerDetail}` };
  }
  const bound = await bindBuildStudioDeliveryShape({ db: prisma as unknown as Db, capsuleId: room.capsuleId, backlogItem });
  return bound.bound
    ? { healed: true, detail: `bound delivery shape ${bound.bound} on ${room.capsuleId} (${bound.reason})${coworkerDetail}` }
    : { healed: coworkersAdmitted, detail: `shape not bound: ${bound.reason}${coworkerDetail}` };
}
