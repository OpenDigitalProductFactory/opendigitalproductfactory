// apps/web/app/(shell)/platform/audit/authority/page.tsx
import { getAgentGrantSummaries } from "@/lib/agent-grants";
import { AuthorityMatrixPanel, type BmrRoleRow } from "@/components/platform/AuthorityMatrixPanel";
import { DelegationChainPanel, type BmrNode } from "@/components/platform/DelegationChainPanel";
import { EffectivePermissionsPanel, type ProductBmr } from "@/components/platform/EffectivePermissionsPanel";
import { listAuthorityBindingRecords } from "@/lib/authority/bindings";
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
  const agentSummaries = await getAgentGrantSummaries();

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

  // Build tools list for effective permissions (serializable subset)
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
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--dpf-text)", margin: 0 }}>
          Authority &amp; Audit
        </h1>
        <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 2 }}>
          Agent grants, delegation chains, and effective permissions. Tool execution history is in{" "}
          <a href="/platform/audit/journal" style={{ color: "var(--dpf-accent)" }}>Capability Journal</a>.
        </p>
      </div>

      {/* Section 1: Authority Matrix */}
      <div style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--dpf-text)", margin: "0 0 12px 0" }}>
          Authority Matrix
        </h2>
        <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginBottom: 12 }}>
          Which agents can access which tool categories. Click a row to see specific grants.
        </p>
        <AuthorityMatrixPanel agents={agentSummaries} bmrRows={bmrRows} />
      </div>

      {/* Section 2: Delegation Chain */}
      <div style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--dpf-text)", margin: "0 0 12px 0" }}>
          Delegation Chain
        </h2>
        <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginBottom: 12 }}>
          Human roles, their supervised agents, HITL tiers, and escalation paths.
        </p>
        <DelegationChainPanel agents={agentSummaries} bmrNodes={bmrNodes} />
      </div>

      {/* Section 3: Effective Permissions Inspector */}
      <div>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--dpf-text)", margin: "0 0 12px 0" }}>
          Effective Permissions Inspector
        </h2>
        <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginBottom: 12 }}>
          Select a user role and agent to see what tools the combination can actually use.
        </p>
        <EffectivePermissionsPanel
          agents={agentSummaries.map((a) => ({ agentId: a.agentId, agentName: a.agentName, grants: a.grants }))}
          roles={ROLES}
          tools={toolsList}
          permissions={permissionsMap}
          products={productBmrList}
          bindings={effectiveBindings}
          bindingHrefBase="/platform/identity/authorization"
        />
      </div>
    </div>
  );
}
