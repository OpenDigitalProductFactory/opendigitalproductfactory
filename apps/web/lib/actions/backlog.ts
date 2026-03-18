"use server";

import * as crypto from "crypto";
import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  validateBacklogInput,
  validateEpicInput,
  type BacklogItemInput,
  type EpicInput,
} from "@/lib/backlog";

async function requireManageBacklog(): Promise<void> {
  const session = await auth();
  const user = session?.user;
  if (
    !user ||
    !can(
      { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
      "manage_backlog"
    )
  ) {
    throw new Error("Unauthorized");
  }
}

async function getSessionUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

// ─── BacklogItem actions ──────────────────────────────────────────────────────

export async function createBacklogItem(input: BacklogItemInput): Promise<void> {
  await requireManageBacklog();
  const error = validateBacklogInput(input);
  if (error) throw new Error(error);

  const createData = {
    itemId:           `BI-${crypto.randomUUID()}`,
    title:            input.title.trim(),
    type:             input.type,
    status:           input.status,
    priority:         input.priority ?? null,
    taxonomyNodeId:   input.taxonomyNodeId ?? null,
    digitalProductId: input.digitalProductId ?? null,
    epicId:           input.epicId ?? null,
    submittedById:    await getSessionUserId(),
    ...(input.body !== undefined && { body: input.body.trim() || null }),
  };
  await prisma.backlogItem.create({ data: createData });
}

export async function updateBacklogItem(id: string, input: BacklogItemInput): Promise<void> {
  await requireManageBacklog();
  const error = validateBacklogInput(input);
  if (error) throw new Error(error);

  const existing = await prisma.backlogItem.findUnique({ where: { id }, select: { status: true } });
  const isNowDone = input.status === "done" || input.status === "deferred";
  const wasDone = existing?.status === "done" || existing?.status === "deferred";

  const updateData = {
    title:            input.title.trim(),
    type:             input.type,
    status:           input.status,
    priority:         input.priority ?? null,
    taxonomyNodeId:   input.taxonomyNodeId ?? null,
    digitalProductId: input.digitalProductId ?? null,
    epicId:           input.epicId ?? null,
    ...(input.body !== undefined && { body: input.body.trim() || null }),
    ...(isNowDone && !wasDone ? { completedAt: new Date() } : {}),
    ...(!isNowDone && wasDone ? { completedAt: null } : {}),
  };
  await prisma.backlogItem.update({ where: { id }, data: updateData });
}

export async function deleteBacklogItem(id: string): Promise<void> {
  await requireManageBacklog();
  await prisma.backlogItem.delete({ where: { id } });
}

// ─── Epic actions ─────────────────────────────────────────────────────────────

export async function createEpic(input: EpicInput): Promise<void> {
  await requireManageBacklog();
  const error = validateEpicInput(input);
  if (error) throw new Error(error);

  await prisma.$transaction(async (tx) => {
    const epic = await tx.epic.create({
      data: {
        epicId:        `EP-${crypto.randomUUID()}`,
        title:         input.title.trim(),
        status:        input.status,
        submittedById: await getSessionUserId(),
        ...(input.description !== undefined && {
          description: input.description.trim() || null,
        }),
      },
    });
    if (input.portfolioIds.length > 0) {
      await tx.epicPortfolio.createMany({
        data: input.portfolioIds.map((portfolioId) => ({
          epicId:      epic.id,
          portfolioId,
        })),
      });
    }

    // Index in platform knowledge for semantic search
    import("@/lib/semantic-memory").then(({ storePlatformKnowledge }) =>
      storePlatformKnowledge({
        entityId: epic.epicId,
        entityType: "epic",
        title: input.title,
        content: input.description ?? "",
      })
    ).catch(() => {});
  });
}

export async function updateEpic(id: string, input: EpicInput): Promise<void> {
  await requireManageBacklog();
  const error = validateEpicInput(input);
  if (error) throw new Error(error);

  const existing = await prisma.epic.findUnique({ where: { id }, select: { status: true } });
  const isNowDone = input.status === "done";
  const wasDone = existing?.status === "done";

  await prisma.$transaction(async (tx) => {
    await tx.epic.update({
      where: { id },
      data: {
        title:  input.title.trim(),
        status: input.status,
        ...(input.description !== undefined && {
          description: input.description.trim() || null,
        }),
        ...(isNowDone && !wasDone ? { completedAt: new Date() } : {}),
        ...(!isNowDone && wasDone ? { completedAt: null } : {}),
      },
    });
    await tx.epicPortfolio.deleteMany({ where: { epicId: id } });
    if (input.portfolioIds.length > 0) {
      await tx.epicPortfolio.createMany({
        data: input.portfolioIds.map((portfolioId) => ({ epicId: id, portfolioId })),
      });
    }
  });
}

export async function deleteEpic(id: string): Promise<void> {
  await requireManageBacklog();
  await prisma.epic.delete({ where: { id } });
  // onDelete: SetNull in schema handles nullifying BacklogItem.epicId automatically
}
