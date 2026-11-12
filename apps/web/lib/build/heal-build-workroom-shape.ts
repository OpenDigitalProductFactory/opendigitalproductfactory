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

import type { Prisma } from "@dpf/db";
import { isRecord } from "@/lib/shared/coerce";
import { readWorkShapeClaim, resolveWorkShapeClaim } from "@/lib/work-management/workroom-shape-claim";
import { resolveDeliveryShape, buildDeliveryShapeClaim } from "@/lib/work-management/derive-delivery-shape";
import { assessDeliverySensitivity } from "@/lib/backlog/initiative-readiness/delivery-sensitivity";
import { lockCurrentArtifactBinding, prepareCurrentArtifactObservation } from "@/lib/backlog/initiative-readiness/current-artifact-observation";
import { scopeClaimEntries, scopeWriteWhere } from "@/lib/work-capsules/scope-input";
import { isTerminalCapsuleStatus } from "@/lib/work-capsules/work-capsule-branch-identity";

export type HealBuildWorkroomShapeResult = { healed: boolean; detail: string };

type ReviewShapeResult =
  | { kind: "ready"; healed: boolean; detail: string }
  | { kind: "held"; detail: string };
type ShapeRecoveryDb = Pick<Prisma.TransactionClient, "featureBuild" | "workroom" | "$queryRaw">;

/** Read only the build's existing native carrier, never another executor's room. */
async function loadReviewShapeBinding(db: ShapeRecoveryDb, buildId: string) {
  const build = await db.featureBuild.findUnique({
    where: { buildId },
    select: {
      id: true, buildId: true, phase: true, createdById: true, updatedAt: true,
      originatingBacklogItemId: true, buildBranch: true, sandboxId: true,
      originator: { select: { id: true, itemId: true, title: true, body: true, effortSize: true, workType: true, updatedAt: true } },
    },
  });
  if (!build || build.phase !== "review" || !build.createdById || !build.originator
    || build.originatingBacklogItemId !== build.originator.id) return { kind: "unavailable" } as const;
  const rooms = await db.workroom.findMany({
    where: { executorKind: "build-studio", executorRef: buildId, archivedAt: null, status: { notIn: ["complete", "abandoned", "archived"] } },
    take: 2,
    select: {
      id: true, capsuleId: true, executorKind: true, executorRef: true, featureBuildId: true,
      backlogItemId: true, status: true, archivedAt: true, scopeClaims: true, updatedAt: true,
      headSha: true, headBranch: true, baseSha: true, repositoryFullName: true,
      leaseHolderPrincipalId: true, createdByPrincipalId: true, requestedByPrincipalId: true,
    },
  });
  const room = rooms[0];
  if (rooms.length !== 1 || !room || room.featureBuildId !== build.id
    || room.executorKind !== "build-studio" || room.executorRef !== buildId
    || ![build.originator.id, build.originator.itemId].includes(room.backlogItemId ?? "")
    || room.archivedAt != null || isTerminalCapsuleStatus(room.status)) return { kind: "unavailable" } as const;
  // canonicalJson intentionally does not call Date.toJSON. Make every source
  // revision timestamp explicit so the shared guard detects concurrent edits.
  return {
    kind: "bound" as const,
    itemRowId: build.originator.id,
    build: { ...build, updatedAt: build.updatedAt.toISOString(), originator: { ...build.originator, updatedAt: build.originator.updatedAt.toISOString() } },
    room: { ...room, updatedAt: room.updatedAt.toISOString() },
  };
}

type ReviewShapeBinding = Extract<Awaited<ReturnType<typeof loadReviewShapeBinding>>, { kind: "bound" }>;
type ReviewShapeEvidence =
  | { kind: "held"; detail: string }
  | { kind: "ready"; binding: ReviewShapeBinding; claim: ReturnType<typeof buildDeliveryShapeClaim> | null };

function reviewShapeEvidence(binding: ReviewShapeBinding): ReviewShapeEvidence {
  const carrier = binding.room.scopeClaims;
  if ((!Array.isArray(carrier) && !isRecord(carrier)) || scopeClaimEntries(carrier).some(entry => !isRecord(entry))) {
    return { kind: "held", detail: "Native Workroom scope metadata is malformed; existing declarations were retained." };
  }
  const declarations = scopeClaimEntries(carrier).filter(entry => isRecord(entry)
    && ["workShape", "workShapeKey", "workShapeVersion"].some(key => Object.hasOwn(entry, key)));
  if (declarations.length) {
    const declaration = declarations[0];
    // A syntactically unreadable or conflicting claim is not an absent claim.
    const mixed = isRecord(declaration) && Object.hasOwn(declaration, "workShape")
      && (Object.hasOwn(declaration, "workShapeKey") || Object.hasOwn(declaration, "workShapeVersion"));
    return declarations.length === 1 && !mixed && resolveWorkShapeClaim([declaration])
      ? { kind: "ready", binding, claim: null }
      : { kind: "held", detail: "Native Workroom delivery declarations are invalid or conflicting; existing declarations were retained." };
  }
  const item = binding.build.originator;
  const resolution = resolveDeliveryShape({ signals: {
    effortSize: item.effortSize, workType: item.workType,
    sensitivity: assessDeliverySensitivity({ title: item.title, body: item.body, workType: item.workType }).level,
  } });
  return resolution.kind === "derived" || resolution.kind === "declared"
    ? { kind: "ready", binding, claim: buildDeliveryShapeClaim(resolution) }
    : { kind: "held", detail: "The governing backlog item does not determine a delivery shape; no declaration was invented." };
}

/** BI-1173F1CC: metadata only. No attachment, coworker admission or gate override. */
export async function reconcileReviewBuildWorkroomShape(input: { buildId: string }): Promise<ReviewShapeResult> {
  const unavailable: ReviewShapeEvidence = { kind: "held", detail: "An unchanged, uniquely build-owned native Workroom and governing item are required for review recovery." };
  try {
    const { prisma } = await import("@dpf/db");
    const observation = await prepareCurrentArtifactObservation<Awaited<ReturnType<typeof loadReviewShapeBinding>>, ReviewShapeEvidence>({
      db: prisma,
      load: db => loadReviewShapeBinding(db as ShapeRecoveryDb, input.buildId),
      read: async binding => reviewShapeEvidence(binding),
      unbound: () => unavailable, unavailable,
      isUnavailable: evidence => evidence.kind === "held",
      lock: async (binding, db) => {
        if (!db.$queryRaw) throw new Error("Build source locking unavailable");
        await db.$queryRaw`SELECT "id" FROM "FeatureBuild" WHERE "id" = ${binding.build.id} FOR SHARE`;
        await lockCurrentArtifactBinding(binding, db);
      },
    });
    if (observation.evidence.kind === "held") return observation.evidence;
    return await prisma.$transaction(async tx => {
      const evidence = await observation.admissionGuard(tx);
      if (evidence.kind === "held") return evidence;
      if (!evidence.claim) return { kind: "ready", healed: false, detail: "Native Workroom delivery shape already bound." } as const;
      const { room } = evidence.binding;
      const changed = await tx.workroom.updateMany({
        where: { ...scopeWriteWhere({ ...room, updatedAt: new Date(room.updatedAt) }), id: room.id },
        data: { scopeClaims: [...scopeClaimEntries(room.scopeClaims), evidence.claim] as Prisma.InputJsonValue },
      });
      return changed.count === 1
        ? { kind: "ready", healed: true, detail: `Restored missing delivery shape on ${room.capsuleId} from its governing item.` } as const
        : { kind: "held", detail: "Native Workroom changed during recovery; no declaration was overwritten." } as const;
    }, { isolationLevel: "Serializable" });
  } catch {
    return { kind: "held", detail: "Native Workroom metadata reconciliation could not complete; existing state was retained." };
  }
}

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
