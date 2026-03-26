"use client";

import { useState } from "react";
import { AGENT_NAME_MAP } from "@/lib/agent-routing";
import type { ToolExecutionRow } from "@/lib/tool-execution-data";

type Props = {
  executions: ToolExecutionRow[];
};

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

function formatToolName(name: string): string {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ToolExecutionLogClient({ executions }: Props) {
  const [agentFilter, setAgentFilter] = useState("all");
  const [toolFilter, setToolFilter] = useState("all");
  const [successFilter, setSuccessFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const agents = [...new Set(executions.map((e) => e.agentId))];
  const tools = [...new Set(executions.map((e) => e.toolName))];

  const filtered = executions.filter((e) => {
    if (agentFilter !== "all" && e.agentId !== agentFilter) return false;
    if (toolFilter !== "all" && e.toolName !== toolFilter) return false;
    if (successFilter === "success" && !e.success) return false;
    if (successFilter === "failure" && e.success) return false;
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
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
          style={selectStyle}
        >
          <option value="all">All agents</option>
          {agents.map((a) => (
            <option key={a} value={a}>{AGENT_NAME_MAP[a] ?? a}</option>
          ))}
        </select>
        <select
          value={toolFilter}
          onChange={(e) => setToolFilter(e.target.value)}
          style={selectStyle}
        >
          <option value="all">All tools</option>
          {tools.map((t) => (
            <option key={t} value={t}>{formatToolName(t)}</option>
          ))}
        </select>
        <select
          value={successFilter}
          onChange={(e) => setSuccessFilter(e.target.value)}
          style={selectStyle}
        >
          <option value="all">All outcomes</option>
          <option value="success">Success</option>
          <option value="failure">Failure</option>
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
          {executions.length === 0
            ? "No tool executions yet. Entries will appear here as agents invoke tools."
            : "No executions match the selected filters."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {/* Header */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "100px 1.2fr 1.5fr 60px 80px 1fr",
            gap: 8,
            padding: "8px 12px",
            fontSize: 10,
            fontWeight: 600,
            color: "var(--dpf-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}>
            <span>Time</span>
            <span>Agent</span>
            <span>Tool</span>
            <span>Success</span>
            <span>Duration</span>
            <span>Route</span>
          </div>

          {/* Rows */}
          {filtered.map((e) => {
            const isExpanded = expandedId === e.id;

            return (
              <div key={e.id}>
                <div
                  onClick={() => setExpandedId(isExpanded ? null : e.id)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "100px 1.2fr 1.5fr 60px 80px 1fr",
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
                  <span style={{ color: "var(--dpf-muted)", fontSize: 11 }}>
                    {timeAgo(e.createdAt)}
                  </span>
                  <span>{AGENT_NAME_MAP[e.agentId] ?? e.agentId}</span>
                  <span>{formatToolName(e.toolName)}</span>
                  <span>
                    <span style={{
                      display: "inline-block",
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: e.success ? "#4ade80" : "#ef4444",
                    }} />
                  </span>
                  <span style={{ color: "var(--dpf-muted)", fontSize: 11 }}>
                    {e.durationMs != null ? `${e.durationMs}ms` : "\u2014"}
                  </span>
                  <span style={{ color: "var(--dpf-muted)", fontSize: 11 }}>
                    {e.routeContext ?? "\u2014"}
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
                    <pre style={{
                      margin: 0,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                      color: "var(--dpf-text)",
                      fontSize: 11,
                      lineHeight: 1.5,
                      background: "#12121e",
                      padding: 10,
                      borderRadius: 4,
                      border: "1px solid var(--dpf-border)",
                    }}>
                      {JSON.stringify(e.parameters, null, 2)}
                    </pre>

                    <div style={{ color: "var(--dpf-accent)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", marginTop: 12, marginBottom: 8 }}>
                      Result
                    </div>
                    <pre style={{
                      margin: 0,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                      color: e.success ? "var(--dpf-text)" : "#ef4444",
                      fontSize: 11,
                      lineHeight: 1.5,
                      background: "#12121e",
                      padding: 10,
                      borderRadius: 4,
                      border: "1px solid var(--dpf-border)",
                    }}>
                      {JSON.stringify(e.result, null, 2)}
                    </pre>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 12, fontSize: 11, color: "var(--dpf-muted)" }}>
                      <div>
                        <span style={{ color: "#666" }}>Execution Mode: </span>
                        {e.executionMode}
                      </div>
                      <div>
                        <span style={{ color: "#666" }}>Thread: </span>
                        {e.threadId.slice(0, 12)}...
                      </div>
                      <div>
                        <span style={{ color: "#666" }}>Created: </span>
                        {new Date(e.createdAt).toLocaleString()}
                      </div>
                    </div>
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
