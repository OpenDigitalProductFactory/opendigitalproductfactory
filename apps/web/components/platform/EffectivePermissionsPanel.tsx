"use client";

import { useEffect, useMemo, useState } from "react";

import {
  explainEffectiveAuthority,
  type EffectiveAuthorityBinding,
} from "@/lib/authority/effective-authority";
import { type AgentIdentitySnapshot } from "@/lib/identity/agent-identity-snapshot";

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
  permissions: Record<string, string[]>;
  products?: ProductBmr[];
  bindings?: EffectiveAuthorityBinding[];
  bindingHrefBase?: string;
  agentSnapshots?: AgentIdentitySnapshot[];
};

/**
 * Maps platform tool names to agent grant categories.
 * Mirrors TOOL_TO_GRANTS from agent-grants.ts for client-side evaluation.
 */
const TOOL_TO_GRANTS: Record<string, string[]> = {
  create_backlog_item: ["backlog_write"],
  update_backlog_item: ["backlog_write"],
  query_backlog: ["backlog_read"],
  report_quality_issue: ["backlog_write"],
  create_digital_product: ["registry_read", "backlog_write"],
  update_lifecycle: ["backlog_write"],
  search_portfolio_context: ["portfolio_read", "registry_read"],
  register_digital_product_from_build: ["registry_read", "backlog_write"],
  create_build_epic: ["backlog_write"],
  search_public_web: ["web_search"],
  fetch_public_website: ["web_search"],
  analyze_public_website_branding: ["web_search"],
  search_integrations: ["external_registry_search", "registry_read"],
  search_knowledge: ["registry_read"],
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
  deploy_feature: ["iac_execute"],
  check_deployment_windows: ["deployment_plan_create"],
  schedule_promotion: ["deployment_plan_create"],
  create_release_bundle: ["release_gate_create"],
  run_release_gate: ["release_gate_create"],
  schedule_release_bundle: ["release_plan_create"],
  get_release_status: ["release_plan_read"],
  evaluate_page: ["file_read"],
  generate_ux_test: ["file_read"],
  run_ux_test: ["file_read"],
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
  add_provider: ["agent_control_read"],
  update_provider_category: ["agent_control_read"],
  run_endpoint_tests: ["agent_control_read"],
  create_employee: ["consumer_write"],
  transition_employee_status: ["consumer_write"],
  propose_leave_policy: ["policy_write"],
  submit_feedback: ["backlog_write"],
  analyze_brand_document: ["file_read"],
  prefill_onboarding_wizard: ["data_governance_validate"],
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
  if (!required) return true;
  return required.some((grant) => agentGrants.includes(grant));
}

function isUserAllowed(
  requiredCapability: string | null,
  roleId: string,
  permissions: Record<string, string[]>,
): boolean {
  if (!requiredCapability) return true;
  const allowedRoles = permissions[requiredCapability];
  if (!allowedRoles) return false;
  return allowedRoles.includes(roleId);
}

const HITL_COLOURS_EP: Record<number, string> = {
  0: "var(--dpf-error)",
  1: "var(--dpf-accent)",
  2: "var(--dpf-info)",
  3: "var(--dpf-success)",
};

const ESCALATION_LABELS_EP: Record<string, string> = {
  "HR-000": "CDIO",
  "HR-100": "Portfolio Mgr",
  "HR-200": "Product Mgr",
  "HR-300": "Architect",
  "HR-400": "ITFM Dir",
  "HR-500": "Ops Mgr",
};

function getFirstRouteForAgent(bindings: EffectiveAuthorityBinding[], agentId: string) {
  return bindings.find((binding) => binding.appliedAgentId === agentId)?.resourceRef ?? "";
}

export function EffectivePermissionsPanel({
  agents,
  roles,
  tools,
  permissions,
  products,
  bindings = [],
  bindingHrefBase = "/platform/identity/authorization",
  agentSnapshots = [],
}: EffectivePermissionsProps) {
  const [selectedRole, setSelectedRole] = useState(roles[0]?.roleId ?? "");
  const [selectedAgent, setSelectedAgent] = useState(agents[0]?.agentId ?? "");
  const [selectedProduct, setSelectedProduct] = useState(products?.[0]?.productId ?? "");
  const [selectedRoute, setSelectedRoute] = useState(() =>
    getFirstRouteForAgent(bindings, agents[0]?.agentId ?? ""),
  );

  const selectedAgentData = useMemo(
    () => agents.find((agent) => agent.agentId === selectedAgent),
    [agents, selectedAgent],
  );

  const routeOptions = useMemo(() => {
    const routes = bindings
      .filter((binding) => binding.appliedAgentId === selectedAgent)
      .map((binding) => binding.resourceRef);

    return Array.from(new Set(routes));
  }, [bindings, selectedAgent]);

  useEffect(() => {
    if (routeOptions.length === 0) {
      if (selectedRoute !== "") {
        setSelectedRoute("");
      }
      return;
    }

    if (!routeOptions.includes(selectedRoute)) {
      setSelectedRoute(routeOptions[0] ?? "");
    }
  }, [routeOptions, selectedRoute]);

  const selectedBinding = useMemo(
    () =>
      bindings.find(
        (binding) =>
          binding.appliedAgentId === selectedAgent &&
          binding.resourceRef === (selectedRoute || getFirstRouteForAgent(bindings, selectedAgent)),
      ) ?? null,
    [bindings, selectedAgent, selectedRoute],
  );
  const selectedAgentSnapshot = useMemo(
    () => agentSnapshots.find((snapshot) => snapshot.agentId === selectedAgent) ?? null,
    [agentSnapshots, selectedAgent],
  );

  const evaluatedTools = useMemo(() => {
    const agentGrants = selectedAgentData?.grants ?? [];

    return tools.map((tool) => {
      const userAllowed = isUserAllowed(tool.requiredCapability, selectedRole, permissions);
      const agentAllowed = isAgentAllowed(tool.toolName, agentGrants);
      const authority = explainEffectiveAuthority({
        roleId: selectedRole,
        agentId: selectedAgent,
        resourceRef: selectedRoute,
        actionKey: tool.toolName,
        userAllowed,
        agentAllowed,
        bindings,
        toolGrantRequirements: TOOL_TO_GRANTS,
      });

      const effective = authority.decision !== "deny";
      const mode =
        authority.decision === "require-approval"
          ? "approval"
          : tool.sideEffect
            ? "proposal"
            : "immediate";

      return {
        ...tool,
        userAllowed,
        agentAllowed,
        effective,
        mode,
        authority,
      };
    });
  }, [bindings, permissions, selectedAgent, selectedAgentData, selectedRole, selectedRoute, tools]);

  const allowedCount = evaluatedTools.filter((tool) => tool.effective).length;
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
      <div style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, color: "var(--dpf-text)", margin: 0 }}>
          Effective Permissions
        </h2>
        <p style={{ fontSize: 10, color: "var(--dpf-muted)", margin: "4px 0 0 0" }}>
          Select a user role and agent to see what tools the combination can actually use.
        </p>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <label
            style={{
              fontSize: 9,
              fontWeight: 600,
              color: "var(--dpf-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            User Role
          </label>
          <select
            value={selectedRole}
            onChange={(event) => setSelectedRole(event.target.value)}
            className={selectClass}
            style={{
              border: "1px solid var(--dpf-border)",
              fontSize: 11,
              padding: "5px 8px",
              borderRadius: 4,
            }}
          >
            {roles.map((role) => (
              <option key={role.roleId} value={role.roleId} className={optionClass}>
                {role.roleId} - {role.roleName}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <label
            style={{
              fontSize: 9,
              fontWeight: 600,
              color: "var(--dpf-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Agent
          </label>
          <select
            value={selectedAgent}
            onChange={(event) => setSelectedAgent(event.target.value)}
            className={selectClass}
            style={{
              border: "1px solid var(--dpf-border)",
              fontSize: 11,
              padding: "5px 8px",
              borderRadius: 4,
            }}
          >
            {agents.map((agent) => (
              <option key={agent.agentId} value={agent.agentId} className={optionClass}>
                {agent.agentId} - {agent.agentName}
              </option>
            ))}
          </select>
        </div>

        {bindings.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <label
              style={{
                fontSize: 9,
                fontWeight: 600,
                color: "var(--dpf-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Route Context
            </label>
            <select
              value={selectedRoute}
              onChange={(event) => setSelectedRoute(event.target.value)}
              className={selectClass}
              style={{
                border: "1px solid var(--dpf-border)",
                fontSize: 11,
                padding: "5px 8px",
                borderRadius: 4,
              }}
            >
              {routeOptions.length === 0 ? (
                <option value="" className={optionClass}>
                  No route binding
                </option>
              ) : (
                routeOptions.map((route) => (
                  <option key={route} value={route} className={optionClass}>
                    {route}
                  </option>
                ))
              )}
            </select>
          </div>
        )}

        {products && products.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <label
              style={{
                fontSize: 9,
                fontWeight: 600,
                color: "var(--dpf-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Product (BMR)
            </label>
            <select
              value={selectedProduct}
              onChange={(event) => setSelectedProduct(event.target.value)}
              className={selectClass}
              style={{
                border: "1px solid var(--dpf-border)",
                fontSize: 11,
                padding: "5px 8px",
                borderRadius: 4,
              }}
            >
              <option value="" className={optionClass}>
                — none —
              </option>
              {products.map((product) => (
                <option key={product.productId} value={product.productId} className={optionClass}>
                  {product.productName}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {selectedBinding && (
        <div
          style={{
            marginBottom: 12,
            padding: "10px 12px",
            borderRadius: 6,
            border: "1px solid var(--dpf-border)",
            background: "var(--dpf-surface-2)",
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span
              style={{
                fontSize: 9,
                fontWeight: 600,
                color: "var(--dpf-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Route Context
            </span>
            <span style={{ fontSize: 11, color: "var(--dpf-text)", fontWeight: 600 }}>
              {selectedBinding.resourceRef}
            </span>
            <span style={{ fontSize: 10, color: "var(--dpf-muted)" }}>
              Binding {selectedBinding.bindingId} · Approval {selectedBinding.approvalMode}
            </span>
          </div>
          <a
            href={`${bindingHrefBase}?binding=${selectedBinding.bindingId}`}
            style={{
              alignSelf: "center",
              fontSize: 10,
              fontWeight: 600,
              color: "var(--dpf-accent)",
              textDecoration: "none",
            }}
          >
            Open binding
          </a>
        </div>
      )}

      {selectedAgentSnapshot && (
        <div
          style={{
            marginBottom: 12,
            padding: "10px 12px",
            borderRadius: 6,
            border: "1px solid var(--dpf-border)",
            background: "var(--dpf-surface-2)",
            display: "grid",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  color: "var(--dpf-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Authority snapshot
              </span>
              <p style={{ margin: "4px 0 0 0", fontSize: 11, color: "var(--dpf-text)", fontWeight: 600 }}>
                {selectedAgentSnapshot.name}
              </p>
            </div>
            <span
              style={{
                fontSize: 10,
                color: "var(--dpf-muted)",
                alignSelf: "flex-start",
              }}
            >
              {selectedAgentSnapshot.validationState}
            </span>
          </div>
          <div style={{ display: "grid", gap: 4 }}>
            <span style={{ fontSize: 10, fontFamily: "monospace", color: "var(--dpf-text)" }}>
              {selectedAgentSnapshot.gaid ?? "No GAID alias"}
            </span>
            <span style={{ fontSize: 10, fontFamily: "monospace", color: "var(--dpf-muted)" }}>
              {selectedAgentSnapshot.operatingProfileFingerprint ?? "No operating profile fingerprint"}
            </span>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {selectedAgentSnapshot.authorizationClasses.length > 0 ? (
              selectedAgentSnapshot.authorizationClasses.map((authClass) => (
                <span
                  key={`${selectedAgentSnapshot.agentId}-${authClass}`}
                  style={{
                    border: "1px solid var(--dpf-border)",
                    borderRadius: 999,
                    padding: "2px 8px",
                    fontSize: 10,
                    color: "var(--dpf-text)",
                  }}
                >
                  {authClass}
                </span>
              ))
            ) : (
              <span style={{ fontSize: 10, color: "var(--dpf-muted)" }}>
                No portable authorization classes projected yet.
              </span>
            )}
          </div>
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <span
              style={{
                fontSize: 9,
                fontWeight: 600,
                color: "var(--dpf-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Memory freshness
            </span>
            <span style={{ fontSize: 10, color: "var(--dpf-text)" }}>
              {selectedAgentSnapshot.memoryFactCurrentCount} current
            </span>
            <span style={{ fontSize: 10, color: "var(--dpf-muted)" }}>
              {selectedAgentSnapshot.memoryFactPendingRevalidationCount} pending
            </span>
            <span style={{ fontSize: 10, color: "var(--dpf-muted)" }}>
              {selectedAgentSnapshot.memoryFactLegacyCount} legacy
            </span>
          </div>
        </div>
      )}

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
          <Dot color="var(--dpf-success)" /> Allowed
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--dpf-muted)" }}>
          <Dot color="var(--dpf-error)" /> Blocked
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--dpf-muted)" }}>
          <Dot color="var(--dpf-muted)" /> N/A
        </span>
      </div>

      <div style={{ overflowX: "auto" }}>
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
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                <span style={{ fontFamily: "monospace", fontSize: 10 }}>{tool.toolName}</span>
                <span style={{ fontSize: 9, color: "var(--dpf-muted)", lineHeight: "12px" }}>
                  {tool.description}
                </span>
                {tool.authority.binding && (
                  <span style={{ fontSize: 9, color: "var(--dpf-muted)", lineHeight: "12px" }}>
                    {tool.authority.binding.bindingId} · {tool.authority.reasonCode}
                  </span>
                )}
              </div>

              <span style={{ textAlign: "center" }}>
                {tool.requiredCapability === null ? (
                  <Dot color="var(--dpf-muted)" />
                ) : tool.userAllowed ? (
                  <Dot color="var(--dpf-success)" />
                ) : (
                  <Dot color="var(--dpf-error)" />
                )}
              </span>

              <span style={{ textAlign: "center" }}>
                {!TOOL_TO_GRANTS[tool.toolName] ? (
                  <Dot color="var(--dpf-muted)" />
                ) : tool.agentAllowed ? (
                  <Dot color="var(--dpf-success)" />
                ) : (
                  <Dot color="var(--dpf-error)" />
                )}
              </span>

              <span style={{ textAlign: "center" }}>
                {tool.effective ? (
                  <Dot color="var(--dpf-success)" />
                ) : (
                  <Dot color="var(--dpf-error)" />
                )}
              </span>

              <span
                style={{
                  textAlign: "center",
                  fontSize: 9,
                  color:
                    tool.mode === "approval" || tool.mode === "proposal"
                      ? "var(--dpf-accent)"
                      : "var(--dpf-muted)",
                  fontWeight: tool.mode === "approval" || tool.mode === "proposal" ? 600 : 400,
                }}
              >
                {tool.mode}
              </span>
            </div>
          ))}
        </div>
      </div>

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
          Approval required: {evaluatedTools.filter((tool) => tool.effective && tool.mode === "approval").length}
        </span>
        <span>
          Proposals: {evaluatedTools.filter((tool) => tool.effective && tool.mode === "proposal").length}
        </span>
        <span>
          Immediate: {evaluatedTools.filter((tool) => tool.effective && tool.mode === "immediate").length}
        </span>
        <span>
          Blocked by role: {evaluatedTools.filter((tool) => !tool.userAllowed && tool.requiredCapability !== null).length}
        </span>
        <span>
          Blocked by grants: {evaluatedTools.filter((tool) => !tool.agentAllowed && !!TOOL_TO_GRANTS[tool.toolName]).length}
        </span>
      </div>

      {products && selectedProduct && (() => {
        const product = products.find((item) => item.productId === selectedProduct);
        if (!product || product.roles.length === 0) return null;
        return (
          <div style={{ marginTop: 16 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: "var(--dpf-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginBottom: 8,
              }}
            >
              BMR Authority Domains — {product.productName}
            </div>

            <div
              style={{
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
              }}
            >
              <span>Role</span>
              <span>Authority Domain</span>
              <span style={{ textAlign: "center" }}>HITL</span>
              <span>Escalates To</span>
              <span>Assigned To</span>
            </div>

            {product.roles.map((role, index) => {
              const tierColour = HITL_COLOURS_EP[role.hitlTierDefault] ?? "var(--dpf-muted)";
              const escalationLabel = role.escalatesTo
                ? (ESCALATION_LABELS_EP[role.escalatesTo] ?? role.escalatesTo)
                : "—";

              return (
                <div
                  key={`${role.roleName}-${index}`}
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
                  <span>{role.roleName}</span>
                  <span style={{ fontSize: 9, color: "var(--dpf-muted)" }}>
                    {role.authorityDomain ?? "—"}
                  </span>
                  <span style={{ textAlign: "center" }}>
                    <span
                      style={{
                        fontSize: 9,
                        background: `${tierColour}20`,
                        color: tierColour,
                        borderRadius: 3,
                        padding: "1px 5px",
                      }}
                    >
                      {role.hitlTierDefault}
                    </span>
                  </span>
                  <span style={{ fontSize: 9, color: "var(--dpf-muted)" }}>{escalationLabel}</span>
                  <span
                    style={{
                      fontSize: 9,
                      color: role.assignee ? "var(--dpf-text)" : "var(--dpf-muted)",
                      fontStyle: role.assignee ? "normal" : "italic",
                    }}
                  >
                    {role.assignee ?? "unassigned"}
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
