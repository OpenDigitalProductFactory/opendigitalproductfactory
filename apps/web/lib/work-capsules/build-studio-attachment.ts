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
};

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
    await args.db.backlogItemActivity.create({
      data: {
        backlogItemId: args.backlogItem.id,
        kind: "build-studio-capsule-attached",
        summary: `Build Studio draft ${args.build.buildId} attached to Work Capsule ${capsule.capsuleId}.`,
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
