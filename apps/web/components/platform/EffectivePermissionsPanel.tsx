"use client";

import { useEffect, useMemo, useState } from "react";

import { SearchableSelect } from "@/components/ui/report-kit/SearchableSelect";
import {
  explainEffectiveAuthority,
  type EffectiveAuthorityBinding,
} from "@/lib/authority/effective-authority";
import { oversightLabel, oversightStyle } from "@/lib/workforce/oversight-copy";
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
 *
 * NOTE: this is a hand-maintained mirror and drifts from the server map. It is
 * display-only — enforcement is server-side via getAvailableTools /
 * isToolAllowedByGrants. Collapsing this onto a single shared/generated grant
 * map is tracked as architect-review Slice 0 item 5 (EP-BROWSER-DRIVE). Until
 * then, add new grant mappings here in the same change as agent-grants.ts.
 */
const TOOL_TO_GRANTS: Record<string, string[]> = {
  // Browser-driving (namespaced MCP) — EP-BROWSER-DRIVE, spec 2026-06-05 §8.2.
  "mcp-browser-use__browse_open": ["browser_read"],
  "mcp-browser-use__browse_extract": ["browser_read"],
  "mcp-browser-use__browse_screenshot": ["browser_read"],
  "mcp-browser-use__browse_close": ["browser_read"],
  "mcp-browser-use__browse_run_tests": ["browser_read"],
  "mcp-browser-use__browse_act": ["browser_drive"],
  drive_browser_task: ["browser_drive"],
  create_backlog_item: ["backlog_write"],
  update_backlog_item: ["backlog_write"],
  query_backlog: ["backlog_read"],
  report_quality_issue: ["backlog_write"],
  list_workrooms: ["work_capsule_read"],
  get_workroom: ["work_capsule_read"],
  create_workroom: ["work_capsule_write"],
  plan_workroom_worktree: ["work_capsule_write"],
  adopt_worktree: ["work_capsule_adopt"],
  claim_workroom_scope: ["work_capsule_write"],
  record_workroom_evidence: ["work_capsule_write"],
  heartbeat_workroom: ["work_capsule_write"],
  update_workroom_status: ["work_capsule_write"],
  release_workroom_scope: ["work_capsule_write"],
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
  get_finance_period_summary: ["financial_report_create"],
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
  get_quiescence_status: ["release_plan_read"],
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

type EvaluatedTool = ToolInfo & {
  userAllowed: boolean;
  agentAllowed: boolean;
  effective: boolean;
  mode: string;
  authority: ReturnType<typeof explainEffectiveAuthority>;
};

const GRID_COLUMNS = "1.8fr 90px 90px 90px 80px";

/** Free-text match over the two fields an operator actually searches by. */
function matchesQuery(tool: EvaluatedTool, query: string): boolean {
  return (
    tool.toolName.toLowerCase().includes(query) ||
    tool.description.toLowerCase().includes(query)
  );
}

function ToolRow({ tool }: { tool: EvaluatedTool }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: GRID_COLUMNS,
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
        {/* Descriptions stay on title= hover only — 350+ full blurbs were
            blowing the UX default-visible word ratchet (~16k words). */}
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
        {tool.effective ? <Dot color="var(--dpf-success)" /> : <Dot color="var(--dpf-error)" />}
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
  );
}

function ToolTable({ tools }: { tools: EvaluatedTool[] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: GRID_COLUMNS,
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
        {tools.map((tool) => (
          <ToolRow key={tool.toolName} tool={tool} />
        ))}
      </div>
    </div>
  );
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
  // Defaults to none. Product is a REFINEMENT of the role+agent question, and
  // auto-selecting the first product rendered its whole BMR authority table on
  // arrival for a product nobody asked about (BI-D6135B88).
  const [selectedProduct, setSelectedProduct] = useState("");
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
  const modeCounts = {
    approval: evaluatedTools.filter((tool) => tool.effective && tool.mode === "approval").length,
    proposal: evaluatedTools.filter((tool) => tool.effective && tool.mode === "proposal").length,
    immediate: evaluatedTools.filter((tool) => tool.effective && tool.mode === "immediate").length,
  };
  const blockedByRole = evaluatedTools.filter(
    (tool) => !tool.userAllowed && tool.requiredCapability !== null,
  ).length;
  const blockedByGrants = evaluatedTools.filter(
    (tool) => !tool.agentAllowed && !!TOOL_TO_GRANTS[tool.toolName],
  ).length;

  // The inventory is the ANSWER ("can this pair run X?"), not the question.
  // Rendering all ~300 rows on arrival made this the estate's worst word
  // offender (BI-D6135B88); rows are now reached by search or the full list.
  const [toolQuery, setToolQuery] = useState("");
  const query = toolQuery.trim().toLowerCase();
  const searching = query.length > 0;
  const matchedTools = useMemo(
    () => (query.length === 0 ? [] : evaluatedTools.filter((tool) => matchesQuery(tool, query))),
    [evaluatedTools, query],
  );

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

      {/* Role and agent ARE the question this panel answers, so they stay in the
          first viewport. Route and product only REFINE an answer, so they move
          behind a disclosure — that keeps the arrival field count at the three
          the reader actually needs (ux-budget `field-load`). */}
      <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <SearchableSelect
          label="User Role"
          options={roles.map((role) => ({
            value: role.roleId,
            label: `${role.roleId} - ${role.roleName}`,
          }))}
          value={selectedRole}
          onChange={setSelectedRole}
        />
        <SearchableSelect
          label="Agent"
          options={agents.map((agent) => ({
            value: agent.agentId,
            label: `${agent.agentId} - ${agent.agentName}`,
          }))}
          value={selectedAgent}
          onChange={setSelectedAgent}
          emptyLabel="No agents projected"
        />
      </div>

      {(bindings.length > 0 || (products && products.length > 0)) && (
        <details
          data-dpf-disclosure=""
          style={{
            marginBottom: 12,
            border: "1px solid var(--dpf-border)",
            borderRadius: 6,
            padding: "8px 10px",
          }}
        >
          <summary
            style={{ cursor: "pointer", fontSize: 12, color: "var(--dpf-text)" }}
          >
            Refine by route or product
          </summary>
          <div style={{ display: "flex", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
            {bindings.length > 0 && (
              <SearchableSelect
                label="Route Context"
                options={routeOptions.map((route) => ({ value: route, label: route }))}
                value={selectedRoute}
                onChange={setSelectedRoute}
                emptyLabel="No route binding"
              />
            )}
            {products && products.length > 0 && (
              <SearchableSelect
                label="Product (BMR)"
                options={[
                  { value: "", label: "— none —" },
                  ...products.map((product) => ({
                    value: product.productId,
                    label: product.productName,
                  })),
                ]}
                value={selectedProduct}
                onChange={setSelectedProduct}
              />
            )}
          </div>
        </details>
      )}

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

      {/* The verdict, in one line. This is what the operator came for; the
          per-tool rows below are the working-out. */}
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
          flexWrap: "wrap",
        }}
      >
        <span style={{ color: "var(--dpf-text)", fontWeight: 600 }}>
          {allowedCount} of {totalCount} tools available
        </span>
        <span style={{ color: "var(--dpf-muted)" }}>{modeCounts.approval} approval</span>
        <span style={{ color: "var(--dpf-muted)" }}>{modeCounts.proposal} proposal</span>
        <span style={{ color: "var(--dpf-muted)" }}>{modeCounts.immediate} immediate</span>
        <span style={{ color: "var(--dpf-muted)" }}>{blockedByRole} blocked by role</span>
        <span style={{ color: "var(--dpf-muted)" }}>{blockedByGrants} blocked by grants</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
        <label
          htmlFor="effective-permissions-tool-search"
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: "var(--dpf-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Find a tool
        </label>
        <input
          id="effective-permissions-tool-search"
          type="search"
          value={toolQuery}
          placeholder={`Search by name or purpose…`}
          onChange={(event) => setToolQuery(event.target.value)}
          style={{
            border: "1px solid var(--dpf-border)",
            background: "var(--dpf-surface-2)",
            color: "var(--dpf-text)",
            fontSize: 12,
            padding: "5px 8px",
            borderRadius: 4,
            maxWidth: 420,
          }}
        />
      </div>

      {searching && matchedTools.length === 0 && (
        <p style={{ fontSize: 12, color: "var(--dpf-muted)", margin: "0 0 12px 0" }}>
          No match for “{toolQuery}”.
        </p>
      )}
      {searching && matchedTools.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <p style={{ fontSize: 11, color: "var(--dpf-muted)", margin: "0 0 6px 0" }}>
            {matchedTools.length} matching
          </p>
          <ToolTable tools={matchedTools} />
        </div>
      )}

      {/* Nothing is hidden without a count and a way to reach it: the full
          inventory is one click away and says how many rows it holds. */}
      <details data-dpf-disclosure="" style={{ marginBottom: 4 }}>
        <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--dpf-text)" }}>
          Browse all {totalCount} tools
        </summary>
        <div style={{ marginTop: 8 }}>
          <ToolTable tools={evaluatedTools} />
        </div>
      </details>

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
              <span style={{ textAlign: "center" }}>Oversight</span>
              <span>Escalates To</span>
              <span>Assigned To</span>
            </div>

            {product.roles.map((role, index) => {
              const tierStyle = oversightStyle(role.hitlTierDefault);
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
                        background: tierStyle.softBg,
                        color: tierStyle.fg,
                        borderRadius: 3,
                        padding: "1px 5px",
                      }}
                    >
                      {oversightLabel(role.hitlTierDefault, { dense: true })}
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
