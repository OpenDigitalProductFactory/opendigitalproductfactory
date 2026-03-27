"use client";

import { useState, useMemo } from "react";

type AgentInfo = {
  agentId: string;
  agentName: string;
  grants: string[];
};

type RoleInfo = {
  roleId: string;
  roleName: string;
};

type ToolInfo = {
  toolName: string;
  description: string;
  requiredCapability: string | null;
  sideEffect: boolean;
};

export type ProductBmr = {
  productId: string;
  productName: string;
  roles: Array<{
    roleName: string;
    authorityDomain: string | null;
    hitlTierDefault: number;
    escalatesTo: string | null;
    assignee: string | null;
  }>;
};

type EffectivePermissionsProps = {
  agents: AgentInfo[];
  roles: RoleInfo[];
  tools: ToolInfo[];
  permissions: Record<string, string[]>; // capability -> roles that have it
  products?: ProductBmr[];
};

/**
 * Maps platform tool names to agent grant categories.
 * Mirrors TOOL_TO_GRANTS from agent-grants.ts for client-side evaluation.
 */
const TOOL_TO_GRANTS: Record<string, string[]> = {
  // Backlog
  create_backlog_item: ["backlog_write"],
  update_backlog_item: ["backlog_write"],
  query_backlog: ["backlog_read"],
  report_quality_issue: ["backlog_write"],
  // Registry / Products
  create_digital_product: ["registry_read", "backlog_write"],
  update_lifecycle: ["backlog_write"],
  search_portfolio_context: ["portfolio_read", "registry_read"],
  register_digital_product_from_build: ["registry_read", "backlog_write"],
  create_build_epic: ["backlog_write"],
  // Web / External
  search_public_web: ["web_search"],
  fetch_public_website: ["web_search"],
  analyze_public_website_branding: ["web_search"],
  search_integrations: ["external_registry_search", "registry_read"],
  search_knowledge: ["registry_read"],
  // Build / Sandbox
  launch_sandbox: ["sandbox_execute"],
  generate_code: ["sandbox_execute"],
  iterate_sandbox: ["sandbox_execute"],
  run_sandbox_tests: ["sandbox_execute"],
  read_sandbox_file: ["sandbox_execute"],
  edit_sandbox_file: ["sandbox_execute"],
  search_sandbox: ["sandbox_execute"],
  list_sandbox_files: ["sandbox_execute"],
  run_sandbox_command: ["sandbox_execute"],
  update_feature_brief: ["backlog_write"],
  assess_complexity: ["backlog_read"],
  propose_decomposition: ["backlog_write"],
  register_tech_debt: ["backlog_write"],
  save_build_notes: ["backlog_write"],
  saveBuildEvidence: ["backlog_write"],
  reviewDesignDoc: ["architecture_read"],
  reviewBuildPlan: ["build_plan_write"],
  // Deploy / Release
  deploy_feature: ["iac_execute"],
  check_deployment_windows: ["deployment_plan_create"],
  schedule_promotion: ["deployment_plan_create"],
  create_release_bundle: ["release_gate_create"],
  run_release_gate: ["release_gate_create"],
  schedule_release_bundle: ["release_plan_create"],
  get_release_status: ["release_plan_read"],
  // UX / Page evaluation
  evaluate_page: ["file_read"],
  generate_ux_test: ["file_read"],
  run_ux_test: ["file_read"],
  // Codebase access
  list_project_directory: ["file_read"],
  read_project_file: ["file_read"],
  search_project_files: ["file_read"],
  query_version_history: ["file_read"],
  generate_codebase_manifest: ["file_read"],
  read_codebase_manifest: ["file_read"],
  read_source_at_version: ["file_read"],
  search_source_at_version: ["file_read"],
  list_source_directory: ["file_read"],
  compare_versions: ["file_read"],
  propose_file_change: ["file_read"],
  propose_improvement: ["decision_record_create"],
  // Provider management
  add_provider: ["agent_control_read"],
  update_provider_category: ["agent_control_read"],
  run_endpoint_tests: ["agent_control_read"],
  // Employee / HR
  create_employee: ["consumer_write"],
  transition_employee_status: ["consumer_write"],
  propose_leave_policy: ["policy_write"],
  // Feedback
  submit_feedback: ["backlog_write"],
  // Brand
  analyze_brand_document: ["file_read"],
  // Compliance
  prefill_onboarding_wizard: ["data_governance_validate"],
  // Tool evaluation
  evaluate_tool: ["tool_evaluation_create"],
};

function Dot({ color }: { color: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: color,
      }}
    />
  );
}

function isAgentAllowed(toolName: string, agentGrants: string[]): boolean {
  const required = TOOL_TO_GRANTS[toolName];
  // Tools not in mapping are allowed by default
  if (!required) return true;
  return required.some((g) => agentGrants.includes(g));
}

function isUserAllowed(
  requiredCapability: string | null,
  roleId: string,
  permissions: Record<string, string[]>,
): boolean {
  // No capability required = always allowed
  if (!requiredCapability) return true;
  const allowedRoles = permissions[requiredCapability];
  if (!allowedRoles) return false;
  return allowedRoles.includes(roleId);
}

const HITL_COLOURS_EP: Record<number, string> = {
  0: "#ef4444",
  1: "#f97316",
  2: "#38bdf8",
  3: "#4ade80",
};

const ESCALATION_LABELS_EP: Record<string, string> = {
  "HR-000": "CDIO",
  "HR-100": "Portfolio Mgr",
  "HR-200": "Product Mgr",
  "HR-300": "Architect",
  "HR-400": "ITFM Dir",
  "HR-500": "Ops Mgr",
};

export function EffectivePermissionsPanel({
  agents,
  roles,
  tools,
  permissions,
  products,
}: EffectivePermissionsProps) {
  const [selectedRole, setSelectedRole] = useState(roles[0]?.roleId ?? "");
  const [selectedAgent, setSelectedAgent] = useState(agents[0]?.agentId ?? "");
  const [selectedProduct, setSelectedProduct] = useState(products?.[0]?.productId ?? "");

  const selectedAgentData = useMemo(
    () => agents.find((a) => a.agentId === selectedAgent),
    [agents, selectedAgent],
  );

  const evaluatedTools = useMemo(() => {
    const agentGrants = selectedAgentData?.grants ?? [];

    return tools.map((tool) => {
      const userOk = isUserAllowed(tool.requiredCapability, selectedRole, permissions);
      const agentOk = isAgentAllowed(tool.toolName, agentGrants);
      const effective = userOk && agentOk;
      const mode = tool.sideEffect ? "proposal" : "immediate";

      return {
        ...tool,
        userAllowed: userOk,
        agentAllowed: agentOk,
        effective,
        mode,
      };
    });
  }, [tools, selectedRole, selectedAgentData, permissions]);

  const allowedCount = evaluatedTools.filter((t) => t.effective).length;
  const totalCount = evaluatedTools.length;

  const selectClass = "bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]";
  const optionClass = "bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]";

  return (
    <div
      style={{
        border: "1px solid var(--dpf-border)",
        borderRadius: 8,
        background: "var(--dpf-surface-1)",
        padding: 16,
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, color: "var(--dpf-text)", margin: 0 }}>
          Effective Permissions
        </h2>
        <p style={{ fontSize: 10, color: "var(--dpf-muted)", margin: "4px 0 0 0" }}>
          Select a user role and agent to see which platform tools are accessible.
        </p>
      </div>

      {/* Dropdowns */}
      <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <label style={{ fontSize: 9, fontWeight: 600, color: "var(--dpf-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            User Role
          </label>
          <select
            value={selectedRole}
            onChange={(e) => setSelectedRole(e.target.value)}
            className={selectClass}
            style={{
              border: "1px solid var(--dpf-border)",
              fontSize: 11,
              padding: "5px 8px",
              borderRadius: 4,
            }}
          >
            {roles.map((r) => (
              <option key={r.roleId} value={r.roleId} className={optionClass}>
                {r.roleId} - {r.roleName}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <label style={{ fontSize: 9, fontWeight: 600, color: "var(--dpf-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Agent
          </label>
          <select
            value={selectedAgent}
            onChange={(e) => setSelectedAgent(e.target.value)}
            className={selectClass}
            style={{
              border: "1px solid var(--dpf-border)",
              fontSize: 11,
              padding: "5px 8px",
              borderRadius: 4,
            }}
          >
            {agents.map((a) => (
              <option key={a.agentId} value={a.agentId} className={optionClass}>
                {a.agentId} - {a.agentName}
              </option>
            ))}
          </select>
        </div>

        {products && products.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <label style={{ fontSize: 9, fontWeight: 600, color: "var(--dpf-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Product (BMR)
            </label>
            <select
              value={selectedProduct}
              onChange={(e) => setSelectedProduct(e.target.value)}
              className={selectClass}
              style={{
                border: "1px solid var(--dpf-border)",
                fontSize: 11,
                padding: "5px 8px",
                borderRadius: 4,
              }}
            >
              <option value="" className={optionClass}>— none —</option>
              {products.map((p) => (
                <option key={p.productId} value={p.productId} className={optionClass}>
                  {p.productName}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Summary stats */}
      <div
        style={{
          display: "flex",
          gap: 16,
          marginBottom: 12,
          padding: "6px 10px",
          borderRadius: 4,
          background: "var(--dpf-surface-2)",
          fontSize: 10,
          alignItems: "center",
        }}
      >
        <span style={{ color: "var(--dpf-text)", fontWeight: 600 }}>
          {allowedCount} of {totalCount} tools available
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--dpf-muted)" }}>
          <Dot color="#4ade80" /> Allowed
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--dpf-muted)" }}>
          <Dot color="#ef4444" /> Blocked
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--dpf-muted)" }}>
          <Dot color="#6b7280" /> N/A
        </span>
      </div>

      {/* Table */}
      <div style={{ overflowX: "auto" }}>
        {/* Table header */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.8fr 90px 90px 90px 80px",
            gap: 8,
            padding: "6px 10px",
            fontSize: 9,
            fontWeight: 600,
            color: "var(--dpf-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            borderBottom: "1px solid var(--dpf-border)",
          }}
        >
          <span>Tool Name</span>
          <span style={{ textAlign: "center" }}>User Allowed</span>
          <span style={{ textAlign: "center" }}>Agent Allowed</span>
          <span style={{ textAlign: "center" }}>Effective</span>
          <span style={{ textAlign: "center" }}>Mode</span>
        </div>

        {/* Table rows */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          {evaluatedTools.map((tool) => (
            <div
              key={tool.toolName}
              style={{
                display: "grid",
                gridTemplateColumns: "1.8fr 90px 90px 90px 80px",
                gap: 8,
                padding: "5px 10px",
                fontSize: 10,
                color: "var(--dpf-text)",
                borderBottom: "1px solid var(--dpf-border)",
                alignItems: "center",
                opacity: tool.effective ? 1 : 0.6,
              }}
              title={tool.description}
            >
              {/* Tool name + description */}
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                <span style={{ fontFamily: "monospace", fontSize: 10 }}>
                  {tool.toolName}
                </span>
                <span style={{ fontSize: 9, color: "var(--dpf-muted)", lineHeight: "12px" }}>
                  {tool.description}
                </span>
              </div>

              {/* User allowed */}
              <span style={{ textAlign: "center" }}>
                {tool.requiredCapability === null ? (
                  <Dot color="#6b7280" />
                ) : tool.userAllowed ? (
                  <Dot color="#4ade80" />
                ) : (
                  <Dot color="#ef4444" />
                )}
              </span>

              {/* Agent allowed */}
              <span style={{ textAlign: "center" }}>
                {!TOOL_TO_GRANTS[tool.toolName] ? (
                  <Dot color="#6b7280" />
                ) : tool.agentAllowed ? (
                  <Dot color="#4ade80" />
                ) : (
                  <Dot color="#ef4444" />
                )}
              </span>

              {/* Effective */}
              <span style={{ textAlign: "center" }}>
                {tool.effective ? (
                  <Dot color="#4ade80" />
                ) : (
                  <Dot color="#ef4444" />
                )}
              </span>

              {/* Mode */}
              <span
                style={{
                  textAlign: "center",
                  fontSize: 9,
                  color: tool.mode === "proposal" ? "#f97316" : "var(--dpf-muted)",
                  fontWeight: tool.mode === "proposal" ? 600 : 400,
                }}
              >
                {tool.mode}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Footer summary */}
      <div
        style={{
          marginTop: 10,
          padding: "6px 10px",
          borderRadius: 4,
          background: "var(--dpf-surface-2)",
          display: "flex",
          gap: 16,
          fontSize: 9,
          color: "var(--dpf-muted)",
          flexWrap: "wrap",
        }}
      >
        <span>
          Proposals: {evaluatedTools.filter((t) => t.effective && t.mode === "proposal").length}
        </span>
        <span>
          Immediate: {evaluatedTools.filter((t) => t.effective && t.mode === "immediate").length}
        </span>
        <span>
          Blocked by role: {evaluatedTools.filter((t) => !t.userAllowed && t.requiredCapability !== null).length}
        </span>
        <span>
          Blocked by grants: {evaluatedTools.filter((t) => !t.agentAllowed && !!TOOL_TO_GRANTS[t.toolName]).length}
        </span>
      </div>

      {/* BMR authority domain section */}
      {products && selectedProduct && (() => {
        const product = products.find((p) => p.productId === selectedProduct);
        if (!product || product.roles.length === 0) return null;
        return (
          <div style={{ marginTop: 16 }}>
            <div style={{
              fontSize: 10,
              fontWeight: 600,
              color: "var(--dpf-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 8,
            }}>
              BMR Authority Domains — {product.productName}
            </div>

            {/* Header */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 60px 80px 1fr",
              gap: 8,
              padding: "5px 10px",
              fontSize: 9,
              fontWeight: 600,
              color: "var(--dpf-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              borderBottom: "1px solid var(--dpf-border)",
            }}>
              <span>Role</span>
              <span>Authority Domain</span>
              <span style={{ textAlign: "center" }}>HITL</span>
              <span>Escalates To</span>
              <span>Assigned To</span>
            </div>

            {product.roles.map((r, i) => {
              const tierColour = HITL_COLOURS_EP[r.hitlTierDefault] ?? "#8888a0";
              const escLabel = r.escalatesTo
                ? (ESCALATION_LABELS_EP[r.escalatesTo] ?? r.escalatesTo)
                : "—";
              return (
                <div
                  key={i}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 60px 80px 1fr",
                    gap: 8,
                    padding: "5px 10px",
                    fontSize: 10,
                    color: "var(--dpf-text)",
                    borderBottom: "1px solid var(--dpf-border)",
                    alignItems: "center",
                  }}
                >
                  <span>{r.roleName}</span>
                  <span style={{ fontSize: 9, color: "var(--dpf-muted)" }}>
                    {r.authorityDomain ?? "—"}
                  </span>
                  <span style={{ textAlign: "center" }}>
                    <span style={{
                      fontSize: 9,
                      background: `${tierColour}20`,
                      color: tierColour,
                      borderRadius: 3,
                      padding: "1px 5px",
                    }}>
                      {r.hitlTierDefault}
                    </span>
                  </span>
                  <span style={{ fontSize: 9, color: "var(--dpf-muted)" }}>{escLabel}</span>
                  <span style={{ fontSize: 9, color: r.assignee ? "var(--dpf-text)" : "var(--dpf-muted)", fontStyle: r.assignee ? "normal" : "italic" }}>
                    {r.assignee ?? "unassigned"}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })()}
    </div>
  );
}
