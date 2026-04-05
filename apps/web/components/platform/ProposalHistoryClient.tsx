"use client";

import { useState } from "react";
import { AGENT_NAME_MAP } from "@/lib/agent-routing";
import type { ProposalRow } from "@/lib/proposal-data";

type Props = {
  proposals: ProposalRow[];
};

const STATUS_COLOURS: Record<string, string> = {
  proposed: "var(--dpf-accent)",
  executed: "var(--dpf-success)",
  rejected: "var(--dpf-error)",
  failed: "var(--dpf-warning)",
};

function formatAction(actionType: string): string {
  return actionType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function ProposalHistoryClient({ proposals }: Props) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [agentFilter, setAgentFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const agents = [...new Set(proposals.map((p) => p.agentId))];

  const filtered = proposals.filter((p) => {
    if (statusFilter !== "all" && p.status !== statusFilter) return false;
    if (agentFilter !== "all" && p.agentId !== agentFilter) return false;
    return true;
  });

  const selectStyle: React.CSSProperties = {
    background: "var(--dpf-surface-1)",
    border: "1px solid var(--dpf-border)",
    color: "var(--dpf-text)",
    fontSize: 12,
    padding: "6px 10px",
    borderRadius: 4,
  };

  return (
    <div>
      {/* Filters */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={selectStyle}
        >
          <option value="all">All statuses</option>
          <option value="proposed">Proposed</option>
          <option value="executed">Executed</option>
          <option value="rejected">Rejected</option>
          <option value="failed">Failed</option>
        </select>
        <select
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
          style={selectStyle}
        >
          <option value="all">All agents</option>
          {agents.map((a) => (
            <option key={a} value={a}>{AGENT_NAME_MAP[a] ?? a}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div style={{
          textAlign: "center",
          padding: "48px 20px",
          color: "var(--dpf-muted)",
          fontSize: 13,
        }}>
          {proposals.length === 0
            ? "No agent actions yet. Agent proposals will appear here when the AI co-worker suggests actions in conversation."
            : "No proposals match the selected filters."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {/* Header */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "1.2fr 1.5fr 100px 100px 1fr 1fr",
            gap: 8,
            padding: "8px 12px",
            fontSize: 10,
            fontWeight: 600,
            color: "var(--dpf-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}>
            <span>Agent</span>
            <span>Action</span>
            <span>Status</span>
            <span>When</span>
            <span>Decided by</span>
            <span>Result</span>
          </div>

          {/* Rows */}
          {filtered.map((p) => {
            const isExpanded = expandedId === p.proposalId;
            const statusColour = STATUS_COLOURS[p.status] ?? "var(--dpf-muted)";

            return (
              <div key={p.proposalId}>
                <div
                  onClick={() => setExpandedId(isExpanded ? null : p.proposalId)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.2fr 1.5fr 100px 100px 1fr 1fr",
                    gap: 8,
                    padding: "10px 12px",
                    background: isExpanded ? "#1e1e35" : "#1a1a2e",
                    border: "1px solid var(--dpf-border)",
                    borderRadius: isExpanded ? "6px 6px 0 0" : 6,
                    cursor: "pointer",
                    fontSize: 12,
                    color: "var(--dpf-text)",
                    alignItems: "center",
                  }}
                >
                  <span>{AGENT_NAME_MAP[p.agentId] ?? p.agentId}</span>
                  <span>{formatAction(p.actionType)}</span>
                  <span style={{
                    color: statusColour,
                    fontSize: 11,
                    fontWeight: 600,
                  }}>
                    {p.status}
                  </span>
                  <span style={{ color: "var(--dpf-muted)", fontSize: 11 }}>
                    {timeAgo(p.proposedAt)}
                  </span>
                  <span style={{ color: "var(--dpf-muted)", fontSize: 11 }}>
                    {p.decidedByEmail ?? "\u2014"}
                  </span>
                  <span style={{ color: "var(--dpf-muted)", fontSize: 11 }}>
                    {p.resultEntityId ?? (p.resultError ? p.resultError.slice(0, 30) + (p.resultError.length > 30 ? "..." : "") : "\u2014")}
                  </span>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div style={{
                    background: "var(--dpf-surface-1)",
                    border: "1px solid var(--dpf-border)",
                    borderTop: "none",
                    borderRadius: "0 0 6px 6px",
                    padding: "12px 16px",
                    fontSize: 12,
                  }}>
                    <div style={{ color: "var(--dpf-accent)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>
                      Parameters
                    </div>
                    {Object.entries(p.parameters).map(([k, v]) => (
                      <div key={k} style={{ marginBottom: 4 }}>
                        <span style={{ color: "var(--dpf-muted)" }}>{k}: </span>
                        <span style={{ color: "var(--dpf-text)" }}>{String(v)}</span>
                      </div>
                    ))}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 12, fontSize: 11, color: "var(--dpf-muted)" }}>
                      <div>
                        <span style={{ color: "#666" }}>Proposed: </span>
                        {new Date(p.proposedAt).toLocaleString()}
                      </div>
                      {p.decidedAt && (
                        <div>
                          <span style={{ color: "#666" }}>Decided: </span>
                          {new Date(p.decidedAt).toLocaleString()}
                        </div>
                      )}
                      {p.executedAt && (
                        <div>
                          <span style={{ color: "#666" }}>Executed: </span>
                          {new Date(p.executedAt).toLocaleString()}
                        </div>
                      )}
                    </div>
                    {p.resultEntityId && (
                      <div style={{ marginTop: 8 }}>
                        <span style={{ color: "#666", fontSize: 11 }}>Created: </span>
                        <span style={{ color: "var(--dpf-success)", fontSize: 11 }}>{p.resultEntityId}</span>
                      </div>
                    )}
                    {p.resultError && (
                      <div style={{ marginTop: 8, color: "var(--dpf-error)", fontSize: 11 }}>
                        {p.resultError}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
