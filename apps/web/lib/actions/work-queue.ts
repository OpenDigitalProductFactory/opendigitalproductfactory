"use server";

import { Prisma, prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { inngest } from "@/lib/queue/inngest-client";
import type {
  WorkItemSourceType,
  WorkItemUrgency,
  WorkItemEffortClass,
  WorkerConstraint,
  RoutingPolicy,
} from "@/lib/queue/queue-types";

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function requireAuth(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  return session.user.id;
}

// ─── Queue CRUD ───────────────────────────────────────────────────────────────

export async function createWorkQueue(data: {
  name: string;
  queueType: string;
  routingPolicy: RoutingPolicy;
  teamId?: string;
  portfolioId?: string;
  digitalProductId?: string;
  slaMinutes?: Record<string, number>;
}) {
  await requireAuth();
  return prisma.workQueue.create({
    data: {
      ...data,
      routingPolicy: toJson(data.routingPolicy),
      slaMinutes: data.slaMinutes ? toJson(data.slaMinutes) : undefined,
    },
  });
}

// ─── Work Item CRUD ───────────────────────────────────────────────────────────

export async function createWorkItem(data: {
  title: string;
  description: string;
  sourceType: WorkItemSourceType;
  sourceId?: string;
  urgency?: WorkItemUrgency;
  effortClass?: WorkItemEffortClass;
  workerConstraint: WorkerConstraint;
  queueId: string;
  teamId?: string;
  dueAt?: Date;
  parentItemId?: string;
}) {
  await requireAuth();

  const item = await prisma.workItem.create({
    data: {
      title: data.title,
      description: data.description,
      sourceType: data.sourceType,
      sourceId: data.sourceId,
      urgency: data.urgency ?? "routine",
      effortClass: data.effortClass ?? "medium",
      workerConstraint: toJson(data.workerConstraint),
      queueId: data.queueId,
      teamId: data.teamId,
      dueAt: data.dueAt,
      parentItemId: data.parentItemId,
    },
  });

  await inngest.send({
    name: "cwq/item.created",
    data: {
      workItemId: item.itemId,
      sourceType: data.sourceType,
      urgency: data.urgency ?? "routine",
    },
  });

  return item;
}

export async function claimWorkItem(itemId: string) {
  const userId = await requireAuth();

  return prisma.workItem.update({
    where: { itemId, status: "queued" },
    data: {
      status: "assigned",
      assignedToType: "human",
      assignedToUserId: userId,
      claimedAt: new Date(),
    },
  });
}

export async function completeWorkItem(
  itemId: string,
  evidence?: Record<string, unknown>,
) {
  await requireAuth();

  const item = await prisma.workItem.update({
    where: { itemId },
    data: {
      status: "completed",
      evidence: evidence ? toJson(evidence) : undefined,
      completedAt: new Date(),
    },
  });

  await inngest.send({
    name: "cwq/item.completed",
    data: { workItemId: itemId, outcome: "success" },
  });

  return item;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function getMyQueue() {
  const userId = await requireAuth();

  return prisma.workItem.findMany({
    where: {
      OR: [
        { assignedToUserId: userId },
        { status: "queued", assignedToUserId: null },
      ],
      status: { notIn: ["completed", "cancelled"] },
    },
    orderBy: [
      { urgency: "asc" },
      { createdAt: "asc" },
    ],
    take: 100,
  });
}

export async function getTriageQueue() {
  await requireAuth();

  return prisma.workItem.findMany({
    where: {
      status: "queued",
      assignedToUserId: null,
      assignedToAgentId: null,
    },
    orderBy: [
      { urgency: "asc" },
      { createdAt: "asc" },
    ],
    take: 100,
  });
}
