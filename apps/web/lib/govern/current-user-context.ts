import { prisma, type Prisma } from "@dpf/db";
import type { UserContext } from "./permissions";

type CurrentHumanRecord = { isActive: boolean; isSuperuser: boolean;
  groups: ReadonlyArray<{ platformRole: { roleId: string } | null }> };

export function currentUserContextFromRecord(userId: string, user: CurrentHumanRecord | null): UserContext | null {
  if (!user?.isActive) return null;
  const platformRoles = [...new Set(user.groups.flatMap((group) =>
    group.platformRole ? [group.platformRole.roleId] : []))];
  return { userId, isSuperuser: user.isSuperuser,
    platformRole: platformRoles[0] ?? null, platformRoles };
}

/** Login establishes identity; current membership determines each operation's authority. */
export async function currentUserContext(userId: string,
  db: Pick<Prisma.TransactionClient, "user"> = prisma,
): Promise<UserContext | null> {
  const user = await db.user.findUnique({ where: { id: userId },
    select: { isActive: true, isSuperuser: true, groups: { include: { platformRole: true } } } });
  return currentUserContextFromRecord(userId, user);
}
