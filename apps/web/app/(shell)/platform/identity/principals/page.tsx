import { prisma } from "@dpf/db";
import { PrincipalDirectoryPanel } from "@/components/platform/identity/PrincipalDirectoryPanel";

export default async function PlatformIdentityPrincipalsPage() {
  const [principals, aliases] = await Promise.all([
    prisma.principal.findMany({
      orderBy: [{ kind: "asc" }, { displayName: "asc" }],
    }),
    prisma.principalAlias.findMany({
      orderBy: [{ aliasType: "asc" }, { aliasValue: "asc" }],
    }),
  ]);

  const aliasesByPrincipalId = new Map<string, typeof aliases>();
  for (const alias of aliases) {
    const group = aliasesByPrincipalId.get(alias.principalId) ?? [];
    group.push(alias);
    aliasesByPrincipalId.set(alias.principalId, group);
  }

  return (
    <PrincipalDirectoryPanel
      principals={principals.map((principal) => ({
        ...principal,
        aliases: (aliasesByPrincipalId.get(principal.id) ?? []).map((alias) => ({
          aliasType: alias.aliasType,
          aliasValue: alias.aliasValue,
          issuer: alias.issuer,
        })),
      }))}
    />
  );
}
