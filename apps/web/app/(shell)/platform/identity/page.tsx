import { prisma } from "@dpf/db";
import { PlatformSummaryCard } from "@/components/platform/PlatformSummaryCard";

export default async function PlatformIdentityPage() {
  const [
    principalCount,
    agentPrincipalCount,
    humanPrincipalCount,
    aliasCount,
    configuredAuthorities,
    employeeCount,
    agentCount,
    groupAssignments,
  ] = await Promise.all([
    prisma.principal.count(),
    prisma.principal.count({ where: { kind: "agent" } }),
    prisma.principal.count({ where: { kind: "human" } }),
    prisma.principalAlias.count(),
    prisma.integrationCredential.count(),
    prisma.employeeProfile.count(),
    prisma.agent.count(),
    prisma.userGroup.count(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Identity &amp; Access</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Operate human, contractor, AI coworker, and service identity from one platform authority plane.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
        <PlatformSummaryCard
          title="Principals"
          description="See the shared inventory of human, agent, and future service identities anchored to the DPF principal spine."
          href="/platform/identity/principals"
          accent="var(--dpf-accent)"
          metrics={[
            { label: "Principals", value: principalCount },
            { label: "Aliases", value: aliasCount },
          ]}
        />
        <PlatformSummaryCard
          title="Directory"
          description="Shape how DPF projects groups, branches, and published authority into directory-compatible views."
          href="/platform/identity/directory"
          accent="var(--dpf-info)"
          metrics={[
            { label: "Humans", value: humanPrincipalCount },
            { label: "Employees", value: employeeCount },
          ]}
        />
        <PlatformSummaryCard
          title="Federation"
          description="Track upstream authorities like Microsoft Entra and other directory anchors without giving away local authorization control."
          href="/platform/identity/federation"
          accent="var(--dpf-success)"
          metrics={[
            { label: "Authorities", value: configuredAuthorities },
            { label: "Linked aliases", value: aliasCount },
          ]}
        />
        <PlatformSummaryCard
          title="Applications"
          description="Manage how relying parties, external products, and future LDAP/SCIM consumers inherit identity and group state."
          href="/platform/identity/applications"
          accent="var(--dpf-warning)"
          metrics={[
            { label: "Group links", value: groupAssignments },
            { label: "DPF-owned", value: "Authoritative" },
          ]}
        />
        <PlatformSummaryCard
          title="Authorization"
          description="Keep route access, business role mappings, and coworker associations legible from the same workspace."
          href="/platform/identity/authorization"
          accent="var(--dpf-info)"
          metrics={[
            { label: "Role links", value: groupAssignments },
            { label: "Scope model", value: "Route-aware" },
          ]}
        />
        <PlatformSummaryCard
          title="Agent Identity"
          description="Review AI workforce identity anchors, current principal coverage, and the path toward GAID- and TAK-aware publication."
          href="/platform/identity/agents"
          accent="var(--dpf-warning)"
          metrics={[
            { label: "Agent principals", value: agentPrincipalCount },
            { label: "AI coworkers", value: agentCount },
          ]}
        />
      </div>

      <div className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
        <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">
          Recommended Flow
        </p>
        <p className="mt-2 text-sm text-[var(--dpf-text)]">
          Start with principals when HR or AI Workforce creates a new identity, confirm group and route mappings in authorization,
          then use directory and federation to decide what gets projected into upstream and downstream systems.
        </p>
      </div>
    </div>
  );
}
