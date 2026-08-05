// apps/web/app/(shell)/platform/audit/authority/page.tsx
import type { ReactNode } from "react";

import { getAgentGrantSummaries } from "@/lib/agent-grants";
import { AuthorityMatrixPanel, type BmrRoleRow } from "@/components/platform/AuthorityMatrixPanel";
import { AgentCardSupervisorPanel } from "@/components/platform/AgentCardSupervisorPanel";
import { DelegationChainPanel, type BmrNode } from "@/components/platform/DelegationChainPanel";
import { EffectivePermissionsPanel, type ProductBmr } from "@/components/platform/EffectivePermissionsPanel";
import { IdentityProjectionSummaryGrid } from "@/components/platform/identity/IdentityProjectionSummaryGrid";
import { listAuthorityBindingRecords } from "@/lib/authority/bindings";
import {
  listAgentIdentitySnapshots,
  summarizeAgentIdentitySnapshots,
} from "@/lib/identity/agent-identity-snapshot";
import { listInternalAgentCards } from "@/lib/tak/agent-card-service";
// mcp-tools is imported dynamically inside the component to avoid NFT whole-project tracing
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@dpf/db";

// Build role list from role_registry
const ROLES = [
  { roleId: "HR-000", roleName: "CDIO / Executive Sponsor" },
  { roleId: "HR-100", roleName: "Portfolio Manager" },
  { roleId: "HR-200", roleName: "Digital Product Manager" },
  { roleId: "HR-300", roleName: "Enterprise Architect" },
  { roleId: "HR-400", roleName: "ITFM Director" },
  { roleId: "HR-500", roleName: "Operations Manager" },
];

export default async function AuditAuthorityPage() {
  const [rawBmrData, bindingRecords] = await Promise.all([
    prisma.productBusinessModel.findMany({
      select: {
        product: { select: { id: true, name: true } },
        businessModel: {
          select: {
            modelId: true,
            name: true,
            isBuiltIn: true,
            roles: {
              where: { status: "active" },
              select: {
                id: true,
                name: true,
                authorityDomain: true,
                hitlTierDefault: true,
                escalatesTo: true,
                assignments: {
                  where: { revokedAt: null },
                  select: { user: { select: { email: true } } },
                  take: 1,
                },
              },
            },
          },
        },
      },
      orderBy: [{ product: { name: "asc" } }],
    }),
    listAuthorityBindingRecords({ statuses: ["active"] }),
  ]);
  const [agentSummaries, agentSnapshots, agentCards] = await Promise.all([
    getAgentGrantSummaries(),
    listAgentIdentitySnapshots(),
    listInternalAgentCards({ routeContext: "/platform/audit/authority" }),
  ]);
  const identitySummary = summarizeAgentIdentitySnapshots(agentSnapshots);

  // Transform BMR data for panels
  const bmrRows: BmrRoleRow[] = rawBmrData.flatMap((pbm) =>
    pbm.businessModel.roles.map((role) => ({
      productId: pbm.product.id,
      productName: pbm.product.name,
      modelName: pbm.businessModel.name,
      isBuiltIn: pbm.businessModel.isBuiltIn,
      roleName: role.name,
      authorityDomain: role.authorityDomain,
      hitlTierDefault: role.hitlTierDefault,
      escalatesTo: role.escalatesTo,
      assignee: role.assignments[0]?.user.email ?? null,
    })),
  );

  const bmrNodes: BmrNode[] = bmrRows
    .filter((r): r is BmrRoleRow & { escalatesTo: string } => r.escalatesTo !== null)
    .map((r) => ({
      productName: r.productName,
      modelName: r.modelName,
      roleName: r.roleName,
      authorityDomain: r.authorityDomain,
      hitlTierDefault: r.hitlTierDefault,
      escalatesTo: r.escalatesTo,
      assignee: r.assignee,
    }));

  // Group BMR roles by product for EffectivePermissionsPanel
  const bmrByProduct = new Map<string, ProductBmr>();
  for (const r of bmrRows) {
    if (!bmrByProduct.has(r.productId)) {
      bmrByProduct.set(r.productId, { productId: r.productId, productName: r.productName, roles: [] });
    }
    bmrByProduct.get(r.productId)!.roles.push({
      roleName: r.roleName,
      authorityDomain: r.authorityDomain,
      hitlTierDefault: r.hitlTierDefault,
      escalatesTo: r.escalatesTo,
      assignee: r.assignee,
    });
  }
  const productBmrList: ProductBmr[] = Array.from(bmrByProduct.values());
  const effectiveBindings = bindingRecords.map((binding) => ({
    bindingId: binding.bindingId,
    resourceRef: binding.resourceRef,
    appliedAgentId: binding.appliedAgentId,
    approvalMode: binding.approvalMode,
    subjects: binding.subjects,
    grants: binding.grants,
  }));

  // Build tools list for effective permissions (serializable subset).
  const { PLATFORM_TOOLS } = await import("@/lib/mcp-tools");
  const toolsList = PLATFORM_TOOLS.map((t) => ({
    toolName: t.name,
    description: t.description,
    requiredCapability: t.requiredCapability ?? null,
    sideEffect: t.sideEffect === true,
  }));

  // Build permissions map: capability -> role IDs that have it
  const permissionsMap: Record<string, string[]> = {};
  for (const [cap, config] of Object.entries(PERMISSIONS)) {
    permissionsMap[cap] = (config as { roles: string[] }).roles;
  }

  return (
    <div>
      <div data-dpf-lead="" style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--dpf-text)", margin: 0 }}>
          Authority &amp; Audit
        </h1>
        <p style={{ fontSize: 12, color: "var(--dpf-muted)", marginTop: 4 }}>
          Who can do what here, and who signed off. {agentSummaries.length} agents,{" "}
          {agentCards.length} agent cards, {bindingRecords.length} route bindings over{" "}
          {toolsList.length} tools. Start with the inspector below; each section opens
          on demand. Past executions live in the{" "}
          <a href="/platform/audit/journal" style={{ color: "var(--dpf-accent)" }}>
            Capability Journal
          </a>
          .
        </p>
      </div>

      {/* The inspector answers the question the page exists for, so it leads —
          the inventories that support it are deferred below (BI-D6135B88). */}
      <div style={{ marginBottom: 24 }}>
        <EffectivePermissionsPanel
          agents={agentSummaries.map((a) => ({ agentId: a.agentId, agentName: a.agentName, grants: a.grants }))}
          agentSnapshots={agentSnapshots}
          roles={ROLES}
          tools={toolsList}
          permissions={permissionsMap}
          products={productBmrList}
          bindings={effectiveBindings}
          bindingHrefBase="/platform/identity/authorization"
        />
      </div>

      <AuthoritySection
        title="Identity projection"
        summary={`${identitySummary.projectedAgents} AIDocs projected · ${identitySummary.unlinkedAgents} still unlinked`}
      >
        <p style={{ fontSize: 12, color: "var(--dpf-muted)", margin: "0 0 12px 0" }}>
          Shared AIDoc coverage over the live authority layer. Runtime grants stay the
          execution truth; the projection makes that truth readable across identity and
          audit surfaces.
        </p>
        <IdentityProjectionSummaryGrid summary={identitySummary} />
      </AuthoritySection>

      <AuthoritySection
        title="Supervisor agent cards"
        summary={`${agentCards.length} cards projected`}
      >
        <AgentCardSupervisorPanel cards={agentCards} />
      </AuthoritySection>

      <AuthoritySection
        title="Authority matrix"
        summary={`${agentSummaries.length} agents × ${bmrRows.length} business-model roles`}
      >
        <p style={{ fontSize: 12, color: "var(--dpf-muted)", margin: "0 0 12px 0" }}>
          Which agents can reach which tool categories. Open a row to see its grants.
        </p>
        <AuthorityMatrixPanel agents={agentSummaries} bmrRows={bmrRows} />
      </AuthoritySection>

      <AuthoritySection
        title="Delegation chain"
        summary={`${bmrNodes.length} roles with an escalation path`}
      >
        <p style={{ fontSize: 12, color: "var(--dpf-muted)", margin: "0 0 12px 0" }}>
          Employee roles, the agents they supervise, oversight tiers, and where each one
          escalates.
        </p>
        <DelegationChainPanel agents={agentSummaries} bmrNodes={bmrNodes} />
      </AuthoritySection>
    </div>
  );
}

/**
 * One deferred dimension of the authority surface.
 *
 * A native <details> rather than a client disclosure component on purpose: this is
 * a server page, the summary carries the COUNT so nothing is hidden without saying
 * how much, and `lib/ux-budget/scope.ts` promotes the summary out of the collapsed
 * subtree — so the reader is measured on the labels they actually meet, not on the
 * inventory behind them.
 */
function AuthoritySection({
  title,
  summary,
  children,
}: {
  title: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <details
      data-dpf-disclosure=""
      style={{
        marginBottom: 12,
        border: "1px solid var(--dpf-border)",
        borderRadius: 8,
        background: "var(--dpf-surface-1)",
        padding: "10px 12px",
      }}
    >
      <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--dpf-text)" }}>
        <span style={{ fontWeight: 600 }}>{title}</span>
        <span style={{ color: "var(--dpf-muted)", fontWeight: 400 }}> — {summary}</span>
      </summary>
      <div style={{ marginTop: 12 }}>{children}</div>
    </details>
  );
}
