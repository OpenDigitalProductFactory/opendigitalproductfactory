"use server";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { validateBacklogInput, type BacklogItemInput } from "@/lib/backlog";

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

export async function createBacklogItem(input: BacklogItemInput): Promise<void> {
  await requireManageBacklog();
  const error = validateBacklogInput(input);
  if (error) throw new Error(error);

  const createData = {
    itemId:          `BI-${crypto.randomUUID()}`,
    title:           input.title.trim(),
    type:            input.type,
    status:          input.status,
    priority:        input.priority ?? null,
    taxonomyNodeId:  input.taxonomyNodeId ?? null,
    digitalProductId: input.digitalProductId ?? null,
    ...(input.body !== undefined && { body: input.body.trim() || null }),
  };
  await prisma.backlogItem.create({ data: createData });
}

export async function updateBacklogItem(id: string, input: BacklogItemInput): Promise<void> {
  await requireManageBacklog();
  const error = validateBacklogInput(input);
  if (error) throw new Error(error);

  const updateData = {
    title:           input.title.trim(),
    type:            input.type,
    status:          input.status,
    priority:        input.priority ?? null,
    taxonomyNodeId:  input.taxonomyNodeId ?? null,
    digitalProductId: input.digitalProductId ?? null,
    ...(input.body !== undefined && { body: input.body.trim() || null }),
  };
  await prisma.backlogItem.update({ where: { id }, data: updateData });
}

export async function deleteBacklogItem(id: string): Promise<void> {
  await requireManageBacklog();
  await prisma.backlogItem.delete({ where: { id } });
}
