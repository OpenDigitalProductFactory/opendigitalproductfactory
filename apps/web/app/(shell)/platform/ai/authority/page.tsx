// apps/web/app/(shell)/platform/ai/authority/page.tsx
import { getToolExecutions, getToolExecutionStats } from "@/lib/tool-execution-data";
import { getAgentGrantSummaries } from "@/lib/agent-grants";
import { ToolExecutionLogClient } from "@/components/platform/ToolExecutionLogClient";
import { AuthorityMatrixPanel } from "@/components/platform/AuthorityMatrixPanel";
import { DelegationChainPanel } from "@/components/platform/DelegationChainPanel";
import { EffectivePermissionsPanel } from "@/components/platform/EffectivePermissionsPanel";
import { AiTabNav } from "@/components/platform/AiTabNav";
import { PLATFORM_TOOLS } from "@/lib/mcp-tools";
import { PERMISSIONS } from "@/lib/permissions";

const STAT_CARDS: Array<{ key: "total" | "successful" | "failed" | "uniqueAgents" | "uniqueTools"; label: string; accent: string }> = [
  { key: "total", label: "Total", accent: "#7c8cf8" },
  { key: "successful", label: "Successful", accent: "#4ade80" },
  { key: "failed", label: "Failed", accent: "#ef4444" },
  { key: "uniqueAgents", label: "Agents", accent: "#38bdf8" },
  { key: "uniqueTools", label: "Tools", accent: "#fbbf24" },
];

// Build role list from role_registry
const ROLES = [
  { roleId: "HR-000", roleName: "CDIO / Executive Sponsor" },
  { roleId: "HR-100", roleName: "Portfolio Manager" },
  { roleId: "HR-200", roleName: "Digital Product Manager" },
  { roleId: "HR-300", roleName: "Enterprise Architect" },
  { roleId: "HR-400", roleName: "ITFM Director" },
  { roleId: "HR-500", roleName: "Operations Manager" },
];

export default async function AuthorityPage() {
  const [executions, stats] = await Promise.all([
    getToolExecutions(),
    getToolExecutionStats(),
  ]);
  const agentSummaries = getAgentGrantSummaries();

  // Build tools list for effective permissions (serializable subset)
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
          Agent grants, delegation chains, effective permissions, and tool execution audit
        </p>
      </div>

      <AiTabNav />

      {/* Section 1: Authority Matrix */}
      <div style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--dpf-text)", margin: "0 0 12px 0" }}>
          Authority Matrix
        </h2>
        <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginBottom: 12 }}>
          Which agents can access which tool categories. Click a row to see specific grants.
        </p>
        <AuthorityMatrixPanel agents={agentSummaries} />
      </div>

      {/* Section 2: Delegation Chain */}
      <div style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--dpf-text)", margin: "0 0 12px 0" }}>
          Delegation Chain
        </h2>
        <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginBottom: 12 }}>
          Human roles, their supervised agents, HITL tiers, and escalation paths.
        </p>
        <DelegationChainPanel agents={agentSummaries} />
      </div>

      {/* Section 3: Effective Permissions Inspector */}
      <div style={{ marginBottom: 32 }}>
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
        />
      </div>

      {/* Section 4: Tool Execution Log */}
      <div>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--dpf-text)", margin: "0 0 12px 0" }}>
          Tool Execution Log
        </h2>

        {stats.total > 0 && (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
            gap: 8,
            marginBottom: 24,
          }}>
            {STAT_CARDS.map((card) => (
              <div
                key={card.key}
                style={{
                  background: "var(--dpf-surface-1)",
                  border: "1px solid var(--dpf-border)",
                  borderLeft: `3px solid ${card.accent}`,
                  borderRadius: 6,
                  padding: "10px 12px",
                }}
              >
                <div style={{ fontSize: 10, color: "var(--dpf-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {card.label}
                </div>
                <div style={{ fontSize: 22, fontWeight: 600, color: "var(--dpf-text)", marginTop: 4 }}>
                  {stats[card.key]}
                </div>
              </div>
            ))}
          </div>
        )}

        <ToolExecutionLogClient executions={executions} />
      </div>
    </div>
  );
}
