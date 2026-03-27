"use client";

import { useState } from "react";

type AgentNode = {
  agentId: string;
  agentName: string;
  tier: string;
  valueStream: string;
  supervisorId: string;
  hitlTier: number;
  escalatesTo: string;
  delegatesTo: string[];
};

export type BmrNode = {
  productName: string;
  modelName: string;
  roleName: string;
  authorityDomain: string | null;
  hitlTierDefault: number;
  escalatesTo: string;
  assignee: string | null;
};

type DelegationChainProps = {
  agents: AgentNode[];
  bmrNodes?: BmrNode[];
};

const HITL_COLORS: Record<number, string> = {
  0: "#ef4444",
  1: "#f97316",
  2: "#3b82f6",
  3: "#4ade80",
};

const HITL_LABELS: Record<number, string> = {
  0: "HITL-0",
  1: "HITL-1",
  2: "HITL-2",
  3: "HITL-3",
};

function HitlBadge({ tier }: { tier: number }) {
  const color = HITL_COLORS[tier] ?? "#8888a0";
  const label = HITL_LABELS[tier] ?? `HITL-${tier}`;
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 9,
        fontWeight: 700,
        padding: "1px 5px",
        borderRadius: 3,
        background: `${color}20`,
        color,
        letterSpacing: "0.04em",
        lineHeight: "14px",
      }}
    >
      {label}
    </span>
  );
}

function ValueStreamTag({ stream }: { stream: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 9,
        padding: "1px 5px",
        borderRadius: 3,
        background: "var(--dpf-surface-2)",
        color: "var(--dpf-muted)",
        letterSpacing: "0.03em",
        lineHeight: "14px",
      }}
    >
      {stream}
    </span>
  );
}

type SupervisorGroup = {
  supervisorId: string;
  /** Top-level agents directly supervised by this human role */
  topAgents: AgentNode[];
};

function buildSupervisorGroups(agents: AgentNode[]): SupervisorGroup[] {
  const bySuper = new Map<string, AgentNode[]>();
  for (const a of agents) {
    const list = bySuper.get(a.supervisorId) ?? [];
    list.push(a);
    bySuper.set(a.supervisorId, list);
  }
  const groups: SupervisorGroup[] = [];
  for (const [supervisorId, topAgents] of bySuper) {
    groups.push({ supervisorId, topAgents });
  }
  // Sort by supervisor ID
  groups.sort((a, b) => a.supervisorId.localeCompare(b.supervisorId));
  return groups;
}

/** Recursively find children via delegatesTo */
function getChildren(parentId: string, allAgents: AgentNode[]): AgentNode[] {
  const parent = allAgents.find((a) => a.agentId === parentId);
  if (!parent || parent.delegatesTo.length === 0) return [];
  return parent.delegatesTo
    .map((childId) => allAgents.find((a) => a.agentId === childId))
    .filter((a): a is AgentNode => !!a);
}

/** Determine which agents are "roots" for a supervisor group:
 *  agents not referenced as a delegatesTo child of any other agent in the group */
function findRoots(topAgents: AgentNode[], allAgents: AgentNode[]): AgentNode[] {
  const childIds = new Set<string>();
  for (const a of topAgents) {
    for (const dId of a.delegatesTo) {
      childIds.add(dId);
    }
  }
  // Also check all agents for delegations into this group
  for (const a of allAgents) {
    for (const dId of a.delegatesTo) {
      childIds.add(dId);
    }
  }
  // Roots = agents in topAgents whose IDs are NOT delegated to by another agent in the same group
  const topIds = new Set(topAgents.map((a) => a.agentId));
  const roots = topAgents.filter((a) => {
    // It's a root if no other agent in topAgents delegates to it
    const delegatedByOther = topAgents.some(
      (other) => other.agentId !== a.agentId && other.delegatesTo.includes(a.agentId)
    );
    return !delegatedByOther;
  });
  return roots.length > 0 ? roots : topAgents;
}

function AgentRow({
  agent,
  allAgents,
  depth,
  expandedSet,
  toggleExpanded,
}: {
  agent: AgentNode;
  allAgents: AgentNode[];
  depth: number;
  expandedSet: Set<string>;
  toggleExpanded: (id: string) => void;
}) {
  const children = getChildren(agent.agentId, allAgents);
  const hasChildren = children.length > 0;
  const isExpanded = expandedSet.has(agent.agentId);

  return (
    <>
      <div
        onClick={hasChildren ? () => toggleExpanded(agent.agentId) : undefined}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 8px",
          paddingLeft: 8 + depth * 20,
          fontSize: 11,
          color: "var(--dpf-text)",
          cursor: hasChildren ? "pointer" : "default",
          borderRadius: 4,
          background: depth === 0 ? "var(--dpf-surface-2)" : "transparent",
        }}
      >
        {/* Expand/collapse indicator */}
        <span
          style={{
            display: "inline-block",
            width: 12,
            fontSize: 9,
            color: "var(--dpf-muted)",
            textAlign: "center",
            userSelect: "none",
          }}
        >
          {hasChildren ? (isExpanded ? "\u25BC" : "\u25B6") : "\u2022"}
        </span>

        {/* Agent ID */}
        <span
          style={{
            fontFamily: "monospace",
            fontSize: 10,
            color: "var(--dpf-accent)",
            minWidth: 90,
          }}
        >
          {agent.agentId}
        </span>

        {/* Agent name */}
        <span style={{ flex: 1, fontSize: 10 }}>
          {agent.agentName}
        </span>

        {/* Tier label */}
        <span
          style={{
            fontSize: 9,
            color: "var(--dpf-muted)",
            minWidth: 40,
          }}
        >
          {agent.tier}
        </span>

        {/* HITL badge */}
        <HitlBadge tier={agent.hitlTier} />

        {/* Value stream */}
        <ValueStreamTag stream={agent.valueStream} />

        {/* Escalation */}
        <span
          style={{
            fontSize: 9,
            color: "var(--dpf-muted)",
            minWidth: 60,
          }}
          title={`Escalates to ${agent.escalatesTo}`}
        >
          esc: {agent.escalatesTo}
        </span>
      </div>

      {/* Children */}
      {hasChildren && isExpanded &&
        children.map((child) => (
          <AgentRow
            key={child.agentId}
            agent={child}
            allAgents={allAgents}
            depth={depth + 1}
            expandedSet={expandedSet}
            toggleExpanded={toggleExpanded}
          />
        ))}
    </>
  );
}

const SUPERVISOR_LABELS: Record<string, string> = {
  "HR-000": "CDIO / Executive Sponsor",
  "HR-100": "Portfolio Manager",
  "HR-200": "Digital Product Manager",
  "HR-300": "Enterprise Architect",
  "HR-400": "ITFM Director",
  "HR-500": "Operations Manager",
};

export function DelegationChainPanel({ agents, bmrNodes }: DelegationChainProps) {
  const [expandedSet, setExpandedSet] = useState<Set<string>>(() => {
    // Start with all nodes expanded
    return new Set(agents.map((a) => a.agentId));
  });

  const toggleExpanded = (id: string) => {
    setExpandedSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const collapseAll = () => setExpandedSet(new Set());
  const expandAll = () => setExpandedSet(new Set(agents.map((a) => a.agentId)));

  const groups = buildSupervisorGroups(agents);

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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <h2 style={{ fontSize: 13, fontWeight: 600, color: "var(--dpf-text)", margin: 0 }}>
            Delegation Chain
          </h2>
          <p style={{ fontSize: 10, color: "var(--dpf-muted)", margin: "4px 0 0 0" }}>
            Human role to agent hierarchy. Click rows to expand/collapse.
          </p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={expandAll}
            style={{
              fontSize: 9,
              padding: "3px 8px",
              borderRadius: 4,
              border: "1px solid var(--dpf-border)",
              background: "var(--dpf-surface-2)",
              color: "var(--dpf-muted)",
              cursor: "pointer",
            }}
          >
            Expand all
          </button>
          <button
            onClick={collapseAll}
            style={{
              fontSize: 9,
              padding: "3px 8px",
              borderRadius: 4,
              border: "1px solid var(--dpf-border)",
              background: "var(--dpf-surface-2)",
              color: "var(--dpf-muted)",
              cursor: "pointer",
            }}
          >
            Collapse all
          </button>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        {[0, 1, 2, 3].map((tier) => (
          <span key={tier} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <HitlBadge tier={tier} />
            <span style={{ fontSize: 9, color: "var(--dpf-muted)" }}>
              {tier === 0 ? "Always human" : tier === 1 ? "Review required" : tier === 2 ? "Spot-check" : "Autonomous"}
            </span>
          </span>
        ))}
      </div>

      {/* Groups */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {groups.map((group) => {
          const roots = findRoots(group.topAgents, agents);

          return (
            <div
              key={group.supervisorId}
              style={{
                border: "1px solid var(--dpf-border)",
                borderRadius: 6,
                overflow: "hidden",
              }}
            >
              {/* Supervisor header */}
              <div
                style={{
                  padding: "6px 10px",
                  background: "var(--dpf-surface-2)",
                  borderBottom: "1px solid var(--dpf-border)",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span
                  style={{
                    fontFamily: "monospace",
                    fontSize: 10,
                    fontWeight: 700,
                    color: "var(--dpf-accent)",
                  }}
                >
                  {group.supervisorId}
                </span>
                <span style={{ fontSize: 10, fontWeight: 600, color: "var(--dpf-text)" }}>
                  {SUPERVISOR_LABELS[group.supervisorId] ?? group.supervisorId}
                </span>
                <span
                  style={{
                    fontSize: 9,
                    color: "var(--dpf-muted)",
                    marginLeft: "auto",
                  }}
                >
                  {group.topAgents.length} agent{group.topAgents.length !== 1 ? "s" : ""}
                </span>
              </div>

              {/* Agent rows */}
              <div style={{ padding: "4px 0", display: "flex", flexDirection: "column", gap: 1 }}>
                {roots.map((agent) => (
                  <AgentRow
                    key={agent.agentId}
                    agent={agent}
                    allAgents={agents}
                    depth={0}
                    expandedSet={expandedSet}
                    toggleExpanded={toggleExpanded}
                  />
                ))}

                {/* BMR role nodes escalating to this supervisor */}
                {bmrNodes
                  ?.filter((n) => n.escalatesTo === group.supervisorId)
                  .map((n, i) => {
                    const tierColour = HITL_COLORS[n.hitlTierDefault] ?? "#8888a0";
                    return (
                      <div
                        key={`bmr-${group.supervisorId}-${i}`}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "4px 8px",
                          paddingLeft: 28,
                          fontSize: 10,
                          color: "var(--dpf-muted)",
                          borderTop: i === 0 ? "1px dashed var(--dpf-border)" : undefined,
                        }}
                      >
                        <span style={{ display: "inline-block", width: 12, fontSize: 9, textAlign: "center", color: "var(--dpf-muted)" }}>
                          ◈
                        </span>
                        <span style={{ fontFamily: "monospace", fontSize: 9, color: "#38bdf8", minWidth: 90 }}>
                          BMR
                        </span>
                        <span style={{ flex: 1 }}>
                          {n.roleName}
                          {n.authorityDomain && (
                            <span style={{ color: "var(--dpf-muted)", marginLeft: 4 }}>
                              · {n.authorityDomain}
                            </span>
                          )}
                        </span>
                        <span style={{ fontSize: 9, color: "var(--dpf-muted)" }}>
                          {n.productName} · {n.modelName}
                        </span>
                        <HitlBadge tier={n.hitlTierDefault} />
                        <span style={{ fontSize: 9, color: n.assignee ? "var(--dpf-text)" : "var(--dpf-muted)", fontStyle: n.assignee ? "normal" : "italic", minWidth: 80, textAlign: "right" }}>
                          {n.assignee ?? "unassigned"}
                        </span>
                      </div>
                    );
                  })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary */}
      <div
        style={{
          marginTop: 12,
          padding: "6px 10px",
          borderRadius: 4,
          background: "var(--dpf-surface-2)",
          display: "flex",
          gap: 16,
          fontSize: 9,
          color: "var(--dpf-muted)",
        }}
      >
        <span>Total agents: {agents.length}</span>
        <span>Supervisor roles: {groups.length}</span>
        <span>
          Tier 0: {agents.filter((a) => a.hitlTier === 0).length} |{" "}
          Tier 1: {agents.filter((a) => a.hitlTier === 1).length} |{" "}
          Tier 2: {agents.filter((a) => a.hitlTier === 2).length} |{" "}
          Tier 3: {agents.filter((a) => a.hitlTier === 3).length}
        </span>
      </div>
    </div>
  );
}
