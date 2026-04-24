import { prisma } from "@dpf/db";

import { DirectoryAuthoritiesPanel } from "@/components/platform/identity/DirectoryAuthoritiesPanel";

const BASE_DN = "dc=dpf,dc=internal";

export default async function PlatformIdentityDirectoryPage() {
  const [
    humanCount,
    agentCount,
    serviceCount,
    aliasCount,
    authorityCount,
    roleGroupCount,
    businessGroupCount,
    authorities,
  ] = await Promise.all([
    prisma.principal.count({ where: { kind: "human" } }),
    prisma.principal.count({ where: { kind: "agent" } }),
    prisma.principal.count({ where: { kind: "service" } }),
    prisma.principalAlias.count(),
    prisma.integrationCredential.count(),
    prisma.platformRole.count(),
    prisma.team.count(),
    prisma.integrationCredential.findMany({
      where: { status: "connected" },
      orderBy: { provider: "asc" },
      select: {
        provider: true,
        status: true,
      },
    }),
  ]);

  const upstreamSummary =
    authorities.length === 0
      ? "No upstream authorities connected yet."
      : `${authorities
          .map((authority) =>
            authority.provider === "entra"
              ? "Microsoft Entra connected"
              : `${authority.provider} connected`,
          )
          .join("; ")}; LDAP/AD optional`;

  return (
    <DirectoryAuthoritiesPanel
      baseDn={BASE_DN}
      branches={[
        {
          dn: `ou=people,${BASE_DN}`,
          label: "People",
          entryCount: humanCount,
          description: "Employees and contractors published as human principals.",
        },
        {
          dn: `ou=agents,${BASE_DN}`,
          label: "Agents",
          entryCount: agentCount,
          description: "AI coworkers published with explicit principal type and stable projected trust markers.",
        },
        {
          dn: `ou=services,${BASE_DN}`,
          label: "Services",
          entryCount: serviceCount,
          description: "Non-human service identities once they are linked into the shared principal spine.",
        },
        {
          dn: `ou=groups,${BASE_DN}`,
          label: "Groups",
          entryCount: roleGroupCount + businessGroupCount,
          description: "Role groups and business groups projected for downstream consumers.",
        },
      ]}
      publicationStatus={{
        authorityCount,
        aliasCount,
        readOnlyConsumers: true,
        primaryAuthorityLabel: "DPF remains authoritative",
        upstreamSummary,
      }}
    />
  );
}
