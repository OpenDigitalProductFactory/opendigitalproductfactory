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

const AUDIT_CLASS_BADGE: Record<string, { label: string; bg: string; color: string }> = {
  ledger:   { label: "Ledger",  bg: "#451a03", color: "#f59e0b" },
  journal:  { label: "Journal", bg: "#1e3a5f", color: "#60a5fa" },
};

export function CapabilityJournalClient({ executions }: Props) {
  const [auditClassFilter, setAuditClassFilter] = useState("all");
  const [successFilter, setSuccessFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = executions.filter((e) => {
    if (auditClassFilter === "ledger" && e.auditClass !== "ledger") return false;
    if (auditClassFilter === "journal" && e.auditClass !== "journal") return false;
    if (successFilter === "success" && !e.success) return false;
    if (successFilter === "failure" && e.success) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!e.toolName.toLowerCase().includes(q) && !(e.capabilityId ?? "").toLowerCase().includes(q)) return false;
    }
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
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <select value={auditClassFilter} onChange={(e) => setAuditClassFilter(e.target.value)} style={selectStyle}>
          <option value="all" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">All classes</option>
          <option value="ledger" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Ledger only</option>
          <option value="journal" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Journal only</option>
        </select>
        <select value={successFilter} onChange={(e) => setSuccessFilter(e.target.value)} style={selectStyle}>
          <option value="all" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">All outcomes</option>
          <option value="success" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Success</option>
          <option value="failure" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Failure</option>
        </select>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tool name or capability..."
          style={{ ...selectStyle, flex: 1, minWidth: 180 }}
        />
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 20px", color: "var(--dpf-muted)", fontSize: 13 }}>
          {executions.length === 0
            ? "No journal-class tool executions recorded yet."
            : "No executions match the selected filters."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {/* Header */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "90px 80px 1.1fr 1.6fr 1fr 60px 70px",
            gap: 8,
            padding: "8px 12px",
            fontSize: 10,
            fontWeight: 600,
            color: "var(--dpf-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}>
            <span>Time</span>
            <span>Class</span>
            <span>Agent</span>
            <span>Tool</span>
            <span>Capability</span>
            <span>OK</span>
            <span>Duration</span>
          </div>

          {filtered.map((e) => {
            const isExpanded = expandedId === e.id;
            const badge = AUDIT_CLASS_BADGE[e.auditClass ?? ""] ?? null;
            const capId = e.capabilityId ?? null;
            const capPrefix = capId?.includes(":") ? capId.split(":")[0] + ":" : null;
            const capName = capPrefix ? capId!.slice(capPrefix.length) : capId;

            return (
              <div key={e.id}>
                <div
                  onClick={() => setExpandedId(isExpanded ? null : e.id)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "90px 80px 1.1fr 1.6fr 1fr 60px 70px",
                    gap: 8,
                    padding: "10px 12px",
                    background: isExpanded ? "var(--dpf-surface-2)" : "var(--dpf-surface-1)",
                    border: "1px solid var(--dpf-border)",
                    borderRadius: isExpanded ? "6px 6px 0 0" : 6,
                    cursor: "pointer",
                    fontSize: 12,
                    color: "var(--dpf-text)",
                    alignItems: "center",
                  }}
                >
                  <span style={{ color: "var(--dpf-muted)", fontSize: 11 }}>{timeAgo(e.createdAt)}</span>
                  <span>
                    {badge ? (
                      <span style={{
                        background: badge.bg,
                        color: badge.color,
                        fontSize: 10,
                        fontWeight: 600,
                        padding: "2px 6px",
                        borderRadius: 4,
                      }}>
                        {badge.label}
                      </span>
                    ) : (
                      <span style={{ color: "var(--dpf-muted)", fontSize: 11 }}>&mdash;</span>
                    )}
                  </span>
                  <span
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                      minWidth: 0,
                    }}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {AGENT_NAME_MAP[e.agentId] ?? e.agentId}
                    </span>
                    {e.agentIdentityRef ? (
                      <span
                        style={{
                          color: "var(--dpf-muted)",
                          fontFamily: "monospace",
                          fontSize: 10,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {e.agentIdentityRef}
                      </span>
                    ) : null}
                  </span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {formatToolName(e.toolName)}
                  </span>
                  <span style={{ fontFamily: "monospace", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {capId ? (
                      <>
                        <span style={{ color: "var(--dpf-muted)" }}>{capPrefix}</span>
                        <span>{capName}</span>
                      </>
                    ) : <span style={{ color: "var(--dpf-muted)" }}>&mdash;</span>}
                  </span>
                  <span>
                    <span style={{
                      display: "inline-block",
                      width: 8, height: 8,
                      borderRadius: "50%",
                      background: e.success ? "var(--dpf-success)" : "var(--dpf-error)",
                    }} />
                  </span>
                  <span style={{ color: "var(--dpf-muted)", fontSize: 11 }}>
                    {e.durationMs != null ? `${e.durationMs}ms` : "\u2014"}
                  </span>
                </div>

                {isExpanded && (
                  <div style={{
                    background: "var(--dpf-surface-1)",
                    border: "1px solid var(--dpf-border)",
                    borderTop: "none",
                    borderRadius: "0 0 6px 6px",
                    padding: "12px 16px",
                    fontSize: 12,
                  }}>
                    {e.summary && Object.keys(e.parameters ?? {}).length === 0 ? (
                      <div style={{ color: "var(--dpf-muted)", fontSize: 11, marginBottom: 8 }}>
                        <span style={{ color: "#666" }}>Summary: </span>{e.summary}
                      </div>
                    ) : (
                      <>
                        <div style={{ color: "var(--dpf-accent)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", marginBottom: 8 }}>
                          Parameters
                        </div>
                        <pre style={{
                          margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all",
                          color: "var(--dpf-text)", fontSize: 11, lineHeight: 1.5,
                          background: "var(--dpf-bg)", padding: 10, borderRadius: 4, border: "1px solid var(--dpf-border)",
                        }}>
                          {JSON.stringify(e.parameters, null, 2)}
                        </pre>
                        <div style={{ color: "var(--dpf-accent)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", marginTop: 12, marginBottom: 8 }}>
                          Result
                        </div>
                        <pre style={{
                          margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all",
                          color: e.success ? "var(--dpf-text)" : "var(--dpf-error)", fontSize: 11, lineHeight: 1.5,
                          background: "var(--dpf-bg)", padding: 10, borderRadius: 4, border: "1px solid var(--dpf-border)",
                        }}>
                          {JSON.stringify(e.result, null, 2)}
                        </pre>
                      </>
                    )}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginTop: 12, fontSize: 11, color: "var(--dpf-muted)" }}>
                      <div><span style={{ color: "var(--dpf-muted)" }}>Mode: </span>{e.executionMode}</div>
                      <div><span style={{ color: "var(--dpf-muted)" }}>Thread: </span>{e.threadId.slice(0, 12)}...</div>
                      <div><span style={{ color: "var(--dpf-muted)" }}>Created: </span>{new Date(e.createdAt).toLocaleString()}</div>
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
