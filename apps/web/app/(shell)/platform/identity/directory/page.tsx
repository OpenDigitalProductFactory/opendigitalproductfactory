import { prisma } from "@dpf/db";

import { DirectoryAuthoritiesPanel } from "@/components/platform/identity/DirectoryAuthoritiesPanel";
import { branchDn } from "@/lib/directory/dn";
import { buildDirectoryProjection } from "@/lib/directory/projection";

// EP-24741BBF · BI-DCE49BA9 — this page renders the SHARED projection; it does
// not compute one. It previously hardcoded `dc=dpf,dc=internal` and counted
// principals inline, which made a route component the second home for a
// contract the LDAP listener and federation also read (AGENTS.md §8). The base
// DN now derives from `Organization`, and what the panel shows is exactly what
// a client that binds would see.

export default async function PlatformIdentityDirectoryPage() {
  const [projection, aliasCount, authorityCount, authorities] = await Promise.all([
    buildDirectoryProjection(),
    prisma.principalAlias.count(),
    prisma.integrationCredential.count(),
    prisma.integrationCredential.findMany({
      where: { status: "connected" },
      orderBy: { provider: "asc" },
      select: { provider: true, status: true },
    }),
  ]);

  const { baseDn, counts } = projection;

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

  // Branch containers are entries too, so subtract them to report published
  // members rather than members-plus-the-container-itself.
  const members = (branch: keyof typeof counts) => Math.max(counts[branch] - 1, 0);

  return (
    <DirectoryAuthoritiesPanel
      baseDn={baseDn}
      branches={[
        {
          dn: branchDn(baseDn, "people"),
          label: "People",
          entryCount: members("people"),
          description: "Employees and contractors published as human principals.",
        },
        {
          dn: branchDn(baseDn, "agents"),
          label: "Agents",
          entryCount: members("agents"),
          description: "AI coworkers published with explicit principal type and trust markers.",
        },
        {
          dn: branchDn(baseDn, "services"),
          label: "Services",
          entryCount: members("services"),
          description: "Service identities on the shared spine, each with an accountable owner.",
        },
        {
          dn: branchDn(baseDn, "groups"),
          label: "Groups",
          entryCount: members("groups"),
          description: "Role and team groups. Organizational structure, not authorization.",
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
