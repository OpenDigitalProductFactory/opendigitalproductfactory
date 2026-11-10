import { prisma, type Prisma } from "@dpf/db";
import type { UserContext } from "./permissions";

type CurrentHumanRecord = { isActive: boolean; isSuperuser: boolean;
  automationExpiresAt?: Date | null;
  groups: ReadonlyArray<{ platformRole: { roleId: string } | null }> };

export function isCurrentUserActive(user: { isActive: boolean; automationExpiresAt?: Date | null } | null, now = new Date()): boolean {
  return !!user?.isActive && (!user.automationExpiresAt || user.automationExpiresAt.getTime() > now.getTime());
}

export function currentUserContextFromRecord(userId: string, user: CurrentHumanRecord | null): UserContext | null {
  if (!user || !isCurrentUserActive(user)) return null;
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
    select: { isActive: true, isSuperuser: true, automationExpiresAt: true, groups: { include: { platformRole: true } } } });
  return currentUserContextFromRecord(userId, user);
}
