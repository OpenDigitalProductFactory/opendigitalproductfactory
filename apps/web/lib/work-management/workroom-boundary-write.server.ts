import { Prisma } from "@dpf/db";

/** Both intent edits and classification recovery must retain the reviewed revision. */
export function workroomBoundaryWriteWhere(room: { id: string; updatedAt: Date; scopeClaims: unknown }): Prisma.WorkroomWhereInput {
  return { id: room.id, updatedAt: room.updatedAt,
    scopeClaims: { equals: room.scopeClaims === null ? Prisma.JsonNull : room.scopeClaims as Prisma.InputJsonValue } };
}
