import { getErrorMessage } from "@/lib/shared/get-error-message";
import {
  createWorkCapsule,
  type CapsuleDb,
  type WorkCapsuleActor,
} from "./work-capsule-store";

type BacklogItemActivityDb = {
  backlogItemActivity: {
    create(args: unknown): Promise<unknown>;
  };
};

export type BuildStudioCapsuleDb = CapsuleDb & BacklogItemActivityDb;

type BuildStudioCapsuleBuild = {
  id: string;
  buildId: string;
  title?: string | null;
  description?: string | null;
  phase?: string | null;
};

type BuildStudioCapsuleBacklogItem = {
  id: string;
  itemId: string;
  title: string;
  body: string | null;
  epicId: string | null;
  epicSemanticId?: string | null;
  taxonomyNodeId?: string | null;
  /** Delivery-shape signals (BI-660E165F): without them the room is unshaped. */
  effortSize?: string | null;
  workType?: string | null;
};

/**
 * BI-660E165F: bind the delivery shape to a Build Studio room the way a
 * governed claim does. The readiness policy reads the shape from the room's
 * work-shape claim (bound-work-shape.ts); a room without one is judged by the
 * v2 feature profile — spec, independent approval, plan document — which a
 * Build Studio build never produces. Observed 2026-09-18: four medium-sized
 * decomposition children gate-blocked at plan -> build for exactly that reason.
 * Ambiguous signals leave the room unshaped rather than guessing.
 */
export async function bindBuildStudioDeliveryShape(args: {
  db: BuildStudioCapsuleDb;
  capsuleId: string;
  backlogItem: BuildStudioCapsuleBacklogItem;
}): Promise<{ bound: string | null; reason: string }> {
  const [{ resolveDeliveryShape }, { deriveDeliverableSensitivity }, { persistClaimShape }] = await Promise.all([
    import("@/lib/work-management/derive-delivery-shape"),
    import("@/lib/explore/build-process-matrix"),
    import("./claim-backlog-item-handler"),
  ]);
  const item = args.backlogItem;
  const resolution = resolveDeliveryShape({
    signals: {
      effortSize: item.effortSize ?? null,
      workType: item.workType ?? null,
      sensitivity: deriveDeliverableSensitivity({ text: `${item.title}\n${item.body ?? ""}`, workType: item.workType ?? null }),
    },
  });
  if (resolution.kind !== "declared" && resolution.kind !== "derived") {
    return { bound: null, reason: resolution.kind === "ambiguous" ? resolution.reason : "shape not resolvable" };
  }
  await persistClaimShape(args.db, args.capsuleId, resolution);
  return { bound: resolution.ref, reason: resolution.kind === "derived" ? resolution.reason : "declared" };
}

function fallbackObjective(buildId: string, title: string): string {
  return `Govern Build Studio work ${buildId}: ${title}`;
}

function cleanText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function attachBuildStudioWorkCapsule(args: {
  db: BuildStudioCapsuleDb;
  build: BuildStudioCapsuleBuild;
  backlogItem?: BuildStudioCapsuleBacklogItem | null;
  actor: WorkCapsuleActor;
}) {
  const idempotencyKey = `build-studio:${args.build.buildId}`;
  const existing = await args.db.workroom.findUnique({
    where: { idempotencyKey },
  });
  if (existing) return existing;

  const title = cleanText(args.build.title) ?? cleanText(args.backlogItem?.title) ?? args.build.buildId;
  const objective =
    cleanText(args.build.description)
    ?? cleanText(args.backlogItem?.body)
    ?? fallbackObjective(args.build.buildId, title);

  const capsule = await createWorkCapsule({
    db: args.db,
    input: {
      title,
      objective,
      source: "build-studio",
      idempotencyKey,
      executorKind: "build-studio",
      executorRef: args.build.buildId,
      status: "working",
      backlogItemId: args.backlogItem?.id ?? null,
      epicId: args.backlogItem?.epicId ?? null,
      featureBuildId: args.build.id,
      workspaceState: {
        buildStudio: {
          buildId: args.build.buildId,
          phase: args.build.phase ?? "ideate",
        },
        ...(args.backlogItem
          ? {
            backlogItem: {
              itemId: args.backlogItem.itemId,
              epicId: args.backlogItem.epicSemanticId ?? null,
              taxonomyNodeId: args.backlogItem.taxonomyNodeId ?? null,
            },
          }
          : {}),
      },
    },
    actor: args.actor,
  });

  if (args.backlogItem) {
    let shapeNote = "";
    try {
      const bound = await bindBuildStudioDeliveryShape({ db: args.db, capsuleId: capsule.capsuleId, backlogItem: args.backlogItem });
      shapeNote = bound.bound ? ` Delivery shape ${bound.bound} bound (${bound.reason}).` : ` Unshaped: ${bound.reason}`;
    } catch (err) {
      shapeNote = ` Unshaped: shape binding failed (${getErrorMessage(err)}).`;
    }
    await args.db.backlogItemActivity.create({
      data: {
        backlogItemId: args.backlogItem.id,
        kind: "build-studio-capsule-attached",
        summary: `Build Studio draft ${args.build.buildId} attached to Work Capsule ${capsule.capsuleId}.${shapeNote}`,
        payload: {
          buildId: args.build.buildId,
          capsuleId: capsule.capsuleId,
          featureBuildId: args.build.id,
          source: "build-studio",
        },
        recordedById: args.actor.userId,
        recordedByAgentId: args.actor.agentId,
      },
    });
  }

  return capsule;
}
