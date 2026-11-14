import { prisma } from "@dpf/db";
import { resolveWorkforcePlatformRole } from "@/lib/govern/auth-utils";

/** Display only: the caller ID must come from authenticated server context. */
export async function loadAuthenticatedAccount(userId: string) {
  const [user, alias] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true, isSuperuser: true,
        groups: { select: { platformRole: { select: { roleId: true, name: true } } } },
      },
    }),
    prisma.principalAlias.findFirst({
      where: { aliasType: "user", aliasValue: userId, issuer: "" },
      select: { principal: { select: { principalId: true, displayName: true, kind: true } } },
    }),
  ]);
  if (!user) return null;
  const roleId = resolveWorkforcePlatformRole(user.groups);
  const role = user.groups.find((group) => group.platformRole?.roleId === roleId)?.platformRole ?? null;
  return {
    userId,
    principalId: alias?.principal.principalId ?? null,
    kind: alias?.principal.kind ?? null,
    displayName: alias?.principal.displayName.trim() || user.email,
    email: user.email,
    platformRole: role?.roleId ?? null,
    roleName: role?.name ?? null,
    isSuperuser: user.isSuperuser,
  };
}
