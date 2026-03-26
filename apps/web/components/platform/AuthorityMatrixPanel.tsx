"use client";

import { useState } from "react";

type AuthorityMatrixProps = {
  agents: Array<{
    agentId: string;
    agentName: string;
    tier: string;
    valueStream: string;
    grants: string[];
  }>;
};

const GRANT_CATEGORIES: Record<string, string[]> = {
  "Backlog": ["backlog_read", "backlog_write", "portfolio_backlog_read", "portfolio_backlog_write", "pbi_status_write", "prod_status_write"],
  "Registry": ["registry_read", "registry_write"],
  "Architecture": ["architecture_read", "architecture_write", "architecture_guardrail_read", "guardrail_validate", "trust_boundary_map"],
  "Finance": ["financial_read", "financial_report_create", "budget_read", "chargeback_write"],
  "Compliance": ["data_governance_validate", "license_check", "regulatory_compliance_check", "retention_record_write", "constraint_validate"],
  "Security": ["vulnerability_scan", "credential_scan", "dependency_audit", "supply_chain_verify"],
  "Deploy": ["iac_execute", "deployment_plan_create", "resource_reservation_write", "rollback_plan_create", "change_event_emit"],
  "Governance": ["policy_read", "policy_write", "strategy_read", "strategy_write", "decision_record_create", "violation_report_create"],
  "Sandbox": ["sandbox_execute"],
  "Tools": ["tool_evaluation_create", "tool_evaluation_read", "tool_evaluation_write", "tool_verdict_create", "risk_score_create", "finding_create"],
};

const CATEGORY_NAMES = Object.keys(GRANT_CATEGORIES);

function agentHasCategory(grants: string[], category: string): boolean {
  const categoryGrants = GRANT_CATEGORIES[category];
  if (!categoryGrants) return false;
  return categoryGrants.some((g) => grants.includes(g));
}

function getMatchingGrants(grants: string[], category: string): string[] {
  const categoryGrants = GRANT_CATEGORIES[category];
  if (!categoryGrants) return [];
  return categoryGrants.filter((g) => grants.includes(g));
}

export function AuthorityMatrixPanel({ agents }: AuthorityMatrixProps) {
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  if (agents.length === 0) {
    return (
      <div style={{
        textAlign: "center",
        padding: "48px 20px",
        color: "var(--dpf-muted)",
        fontSize: 13,
      }}>
        No agents found. Agent authority data will appear here when agents are registered.
      </div>
    );
  }

  // Build grid template: agent name column + one column per category
  const gridCols = `160px repeat(${CATEGORY_NAMES.length}, 1fr)`;

  return (
    <div>
      {/* Header row */}
      <div style={{
        display: "grid",
        gridTemplateColumns: gridCols,
        gap: 1,
        marginBottom: 1,
      }}>
        {/* Top-left corner */}
        <div style={{
          padding: "6px 8px",
          fontSize: 10,
          fontWeight: 600,
          color: "var(--dpf-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          background: "var(--dpf-surface-1)",
          borderRadius: "4px 0 0 0",
        }}>
          Agent
        </div>
        {CATEGORY_NAMES.map((cat, i) => (
          <div
            key={cat}
            style={{
              padding: "6px 4px",
              fontSize: 10,
              fontWeight: 600,
              color: "var(--dpf-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.03em",
              textAlign: "center",
              background: "var(--dpf-surface-1)",
              borderRadius: i === CATEGORY_NAMES.length - 1 ? "0 4px 0 0" : 0,
            }}
          >
            {cat}
          </div>
        ))}
      </div>

      {/* Agent rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {agents.map((agent) => {
          const isExpanded = expandedAgent === agent.agentId;

          return (
            <div key={agent.agentId}>
              {/* Heatmap row */}
              <div
                onClick={() => setExpandedAgent(isExpanded ? null : agent.agentId)}
                style={{
                  display: "grid",
                  gridTemplateColumns: gridCols,
                  gap: 1,
                  cursor: "pointer",
                }}
              >
                {/* Agent name cell */}
                <div style={{
                  padding: "6px 8px",
                  fontSize: 11,
                  fontWeight: 500,
                  color: "var(--dpf-text)",
                  background: isExpanded ? "var(--dpf-surface-1)" : "var(--dpf-surface-2)",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  overflow: "hidden",
                }}>
                  <span style={{
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}>
                    {agent.agentName}
                  </span>
                  <span style={{
                    fontSize: 9,
                    color: "var(--dpf-muted)",
                    flexShrink: 0,
                  }}>
                    {isExpanded ? "\u25B2" : "\u25BC"}
                  </span>
                </div>

                {/* Category cells */}
                {CATEGORY_NAMES.map((cat) => {
                  const hasAccess = agentHasCategory(agent.grants, cat);
                  return (
                    <div
                      key={cat}
                      style={{
                        padding: "6px 4px",
                        background: hasAccess ? "#4ade80" : "var(--dpf-surface-2)",
                        opacity: hasAccess ? 1 : 0.6,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        minHeight: 28,
                      }}
                      title={hasAccess
                        ? `${agent.agentName}: ${getMatchingGrants(agent.grants, cat).join(", ")}`
                        : `${agent.agentName}: no ${cat.toLowerCase()} grants`
                      }
                    >
                      {hasAccess && (
                        <span style={{ fontSize: 9, color: "#0a3d1a", fontWeight: 600 }}>
                          {getMatchingGrants(agent.grants, cat).length}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div style={{
                  background: "var(--dpf-surface-1)",
                  border: "1px solid var(--dpf-border)",
                  borderTop: "none",
                  borderRadius: "0 0 6px 6px",
                  padding: "10px 12px",
                  fontSize: 11,
                }}>
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 1fr",
                    gap: 6,
                    marginBottom: 10,
                    fontSize: 10,
                  }}>
                    <div>
                      <span style={{ color: "var(--dpf-muted)" }}>Tier: </span>
                      <span style={{ color: "var(--dpf-text)" }}>{agent.tier}</span>
                    </div>
                    <div>
                      <span style={{ color: "var(--dpf-muted)" }}>Stream: </span>
                      <span style={{ color: "var(--dpf-text)" }}>{agent.valueStream}</span>
                    </div>
                    <div>
                      <span style={{ color: "var(--dpf-muted)" }}>Total grants: </span>
                      <span style={{ color: "var(--dpf-text)" }}>{agent.grants.length}</span>
                    </div>
                  </div>

                  <div style={{
                    color: "var(--dpf-accent)",
                    fontSize: 10,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    marginBottom: 8,
                  }}>
                    Grants by Category
                  </div>

                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                    gap: 8,
                  }}>
                    {CATEGORY_NAMES.filter((cat) => agentHasCategory(agent.grants, cat)).map((cat) => (
                      <div key={cat}>
                        <div style={{
                          fontSize: 10,
                          fontWeight: 600,
                          color: "var(--dpf-text)",
                          marginBottom: 3,
                        }}>
                          {cat}
                        </div>
                        {getMatchingGrants(agent.grants, cat).map((g) => (
                          <div key={g} style={{
                            fontSize: 9,
                            color: "var(--dpf-muted)",
                            padding: "1px 0",
                            fontFamily: "monospace",
                          }}>
                            {g}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>

                  {/* Uncategorized grants */}
                  {(() => {
                    const allCategorized = new Set(
                      Object.values(GRANT_CATEGORIES).flat()
                    );
                    const uncategorized = agent.grants.filter(
                      (g) => !allCategorized.has(g)
                    );
                    if (uncategorized.length === 0) return null;
                    return (
                      <div style={{ marginTop: 10 }}>
                        <div style={{
                          fontSize: 10,
                          fontWeight: 600,
                          color: "var(--dpf-text)",
                          marginBottom: 3,
                        }}>
                          Other
                        </div>
                        {uncategorized.map((g) => (
                          <div key={g} style={{
                            fontSize: 9,
                            color: "var(--dpf-muted)",
                            padding: "1px 0",
                            fontFamily: "monospace",
                          }}>
                            {g}
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div style={{
        display: "flex",
        gap: 16,
        marginTop: 12,
        fontSize: 9,
        color: "var(--dpf-muted)",
        alignItems: "center",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{ width: 12, height: 12, borderRadius: 2, background: "#4ade80" }} />
          <span>Has grants</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{ width: 12, height: 12, borderRadius: 2, background: "var(--dpf-surface-2)", opacity: 0.6 }} />
          <span>No grants</span>
        </div>
        <span style={{ marginLeft: "auto" }}>Click a row to expand grant details</span>
      </div>
    </div>
  );
}
