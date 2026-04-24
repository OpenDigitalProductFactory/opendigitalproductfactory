import { prisma } from "@dpf/db";

import { ApplicationAssignmentsPanel } from "@/components/platform/identity/ApplicationAssignmentsPanel";

export default async function PlatformIdentityApplicationsPage() {
  const [authorityCount, aliasCount, roleAssignmentCount, businessGroupCount, connectedAuthorities] = await Promise.all([
    prisma.integrationCredential.count(),
    prisma.principalAlias.count(),
    prisma.userGroup.count(),
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

  const hasModernAuthority = connectedAuthorities.some((authority) => authority.provider === "entra");
  const hasDirectoryAuthority = connectedAuthorities.some((authority) => authority.provider === "ldap" || authority.provider === "active_directory");
  const connectionSummary = connectedAuthorities.length === 0
    ? "No upstream authorities connected yet."
    : connectedAuthorities.map((authority) => `${authority.provider} connected`).join("; ");

  return (
    <ApplicationAssignmentsPanel
      protocolProfiles={[
        {
          protocol: "oidc",
          label: "OIDC",
          readiness: hasModernAuthority ? "ready" : "planned",
          description: "Use for modern relying parties and external products that need workforce login and claims-based access.",
          contractFields: ["claims", "groups", "manager-aware scope"],
        },
        {
          protocol: "saml",
          label: "SAML",
          readiness: hasModernAuthority ? "ready" : "planned",
          description: "Use for older enterprise applications that still depend on SAML assertions.",
          contractFields: ["claims", "groups"],
        },
        {
          protocol: "ldap-only",
          label: "LDAP-only",
          readiness: hasDirectoryAuthority ? "ready" : "planned",
          description: "Use for directory-bound consumers that only need bind support or group lookups.",
          contractFields: ["groups", "directory projection"],
        },
      ]}
      publicationMetrics={{
        authorityCount,
        aliasCount,
        roleAssignmentCount,
        businessGroupCount,
        provisioningSummary: "Manual today, SCIM-ready next",
        connectionSummary,
      }}
    />
  );
}
