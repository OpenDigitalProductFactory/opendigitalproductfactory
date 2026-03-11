// Pure auth utilities — no next-auth dependency, safe for test environments.

export function extractPlatformRole(
  session: { user: { groups: Array<{ platform_role: string }> } } | null
): string | null {
  if (!session?.user?.groups?.length) return null;
  return session.user.groups[0]?.platform_role ?? null;
}
