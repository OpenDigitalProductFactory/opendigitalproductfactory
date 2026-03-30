"use client";

import { useState, useTransition } from "react";
import { saveAgentModelConfig } from "@/lib/actions/agent-model-config";

type AgentRow = {
  agentId: string;
  agentName: string;
  minimumTier: string;
  budgetClass: string;
  pinnedProviderId: string | null;
  pinnedModelId: string | null;
  lastModel: string | null;
  isDbConfig: boolean;
};

type Provider = {
  providerId: string;
  name: string;
  models: Array<{ modelId: string; friendlyName: string }>;
};

const TIERS = [
  { value: "frontier", label: "Frontier", hint: "Best available" },
  { value: "strong", label: "Strong", hint: "Good for most tasks" },
  { value: "adequate", label: "Adequate", hint: "Basic tasks" },
  { value: "basic", label: "Basic", hint: "Local models only" },
];

const BUDGET_CLASSES = [
  { value: "quality_first", label: "Quality" },
  { value: "balanced", label: "Balanced" },
  { value: "minimize_cost", label: "Cost" },
];

export function AgentModelAssignmentTable({
  agents,
  providers,
  canWrite,
}: {
  agents: AgentRow[];
  providers: Provider[];
  canWrite: boolean;
}) {
  const [rows, setRows] = useState(agents);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});

  async function handleSave(agentId: string) {
    const row = rows.find((r) => r.agentId === agentId);
    if (!row) return;

    setSaving((s) => ({ ...s, [agentId]: true }));
    const result = await saveAgentModelConfig(
      agentId,
      row.minimumTier,
      row.budgetClass,
      row.pinnedProviderId,
      row.pinnedModelId,
    );
    setSaving((s) => ({ ...s, [agentId]: false }));

    if (result.ok) {
      setSaved((s) => ({ ...s, [agentId]: true }));
      setRows((prev) =>
        prev.map((r) => (r.agentId === agentId ? { ...r, isDbConfig: true } : r)),
      );
      setTimeout(() => setSaved((s) => ({ ...s, [agentId]: false })), 2000);
    }
  }

  function updateRow(agentId: string, field: keyof AgentRow, value: string | null) {
    setRows((prev) =>
      prev.map((r) => (r.agentId === agentId ? { ...r, [field]: value } : r)),
    );
  }

  const cellStyle: React.CSSProperties = {
    padding: "8px 12px",
    fontSize: 13,
    borderBottom: "1px solid var(--dpf-border)",
    color: "var(--dpf-text)",
  };

  const selectStyle: React.CSSProperties = {
    padding: "4px 8px",
    fontSize: 12,
    borderRadius: 4,
    border: "1px solid var(--dpf-border)",
    background: "var(--dpf-surface-1)",
    color: "var(--dpf-text)",
    cursor: canWrite ? "pointer" : "not-allowed",
  };

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid var(--dpf-border)" }}>
            <th style={{ ...cellStyle, fontWeight: 600, textAlign: "left" }}>Agent</th>
            <th style={{ ...cellStyle, fontWeight: 600, textAlign: "left" }}>Minimum Quality</th>
            <th style={{ ...cellStyle, fontWeight: 600, textAlign: "left" }}>Budget</th>
            <th style={{ ...cellStyle, fontWeight: 600, textAlign: "left" }}>Current Model</th>
            <th style={{ ...cellStyle, fontWeight: 600, textAlign: "center", width: 80 }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <>
              <tr key={row.agentId}>
                <td style={cellStyle}>
                  <div>
                    <span style={{ fontWeight: 500 }}>{row.agentName}</span>
                    <span
                      style={{
                        display: "block",
                        fontSize: 11,
                        color: "var(--dpf-muted)",
                      }}
                    >
                      {row.agentId}
                    </span>
                  </div>
                </td>
                <td style={cellStyle}>
                  <select
                    value={row.minimumTier}
                    onChange={(e) => updateRow(row.agentId, "minimumTier", e.target.value)}
                    disabled={!canWrite || !!row.pinnedModelId}
                    style={{
                      ...selectStyle,
                      opacity: row.pinnedModelId ? 0.5 : 1,
                    }}
                  >
                    {TIERS.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td style={cellStyle}>
                  <select
                    value={row.budgetClass}
                    onChange={(e) => updateRow(row.agentId, "budgetClass", e.target.value)}
                    disabled={!canWrite}
                    style={selectStyle}
                  >
                    {BUDGET_CLASSES.map((b) => (
                      <option key={b.value} value={b.value}>
                        {b.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td style={cellStyle}>
                  <span style={{ fontSize: 12, color: "var(--dpf-muted)" }}>
                    {row.lastModel ?? "—"}
                  </span>
                </td>
                <td style={{ ...cellStyle, textAlign: "center" }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "center" }}>
                    {canWrite && (
                      <button
                        onClick={() => handleSave(row.agentId)}
                        disabled={saving[row.agentId]}
                        style={{
                          padding: "3px 10px",
                          fontSize: 11,
                          borderRadius: 4,
                          border: "1px solid var(--dpf-accent)",
                          background: "transparent",
                          color: "var(--dpf-accent)",
                          cursor: saving[row.agentId] ? "wait" : "pointer",
                        }}
                      >
                        {saving[row.agentId] ? "..." : "Save"}
                      </button>
                    )}
                    {saved[row.agentId] && (
                      <span style={{ fontSize: 10, color: "#4ade80" }}>Saved</span>
                    )}
                    {canWrite && (
                      <button
                        onClick={() =>
                          setExpandedAgent(
                            expandedAgent === row.agentId ? null : row.agentId,
                          )
                        }
                        style={{
                          padding: "3px 8px",
                          fontSize: 10,
                          borderRadius: 4,
                          border: "1px solid var(--dpf-border)",
                          background: "transparent",
                          color: "var(--dpf-muted)",
                          cursor: "pointer",
                        }}
                      >
                        {expandedAgent === row.agentId ? "Hide" : "Advanced"}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
              {expandedAgent === row.agentId && (
                <tr key={`${row.agentId}-adv`}>
                  <td
                    colSpan={5}
                    style={{
                      padding: "8px 12px 16px 24px",
                      borderBottom: "1px solid var(--dpf-border)",
                      background: "var(--dpf-bg)",
                    }}
                  >
                    <div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
                      <div>
                        <label style={{ fontSize: 11, color: "var(--dpf-muted)", display: "block", marginBottom: 4 }}>
                          Pin to Provider
                        </label>
                        <select
                          value={row.pinnedProviderId ?? ""}
                          onChange={(e) => {
                            updateRow(row.agentId, "pinnedProviderId", e.target.value || null);
                            if (!e.target.value) updateRow(row.agentId, "pinnedModelId", null);
                          }}
                          style={selectStyle}
                        >
                          <option value="">Auto</option>
                          {providers.map((p) => (
                            <option key={p.providerId} value={p.providerId}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize: 11, color: "var(--dpf-muted)", display: "block", marginBottom: 4 }}>
                          Pin to Model
                        </label>
                        <select
                          value={row.pinnedModelId ?? ""}
                          onChange={(e) =>
                            updateRow(row.agentId, "pinnedModelId", e.target.value || null)
                          }
                          disabled={!row.pinnedProviderId}
                          style={{
                            ...selectStyle,
                            opacity: row.pinnedProviderId ? 1 : 0.5,
                          }}
                        >
                          <option value="">Auto</option>
                          {row.pinnedProviderId &&
                            providers
                              .find((p) => p.providerId === row.pinnedProviderId)
                              ?.models.map((m) => (
                                <option key={m.modelId} value={m.modelId}>
                                  {m.friendlyName}
                                </option>
                              ))}
                        </select>
                      </div>
                      {row.isDbConfig && (
                        <span
                          style={{
                            fontSize: 10,
                            color: "var(--dpf-muted)",
                            padding: "2px 6px",
                            border: "1px solid var(--dpf-border)",
                            borderRadius: 4,
                          }}
                        >
                          Admin configured
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 12 }}>
        Current Model shows the model the router selected last time this agent was invoked.
        Change Minimum Quality to influence selection.
      </p>
    </div>
  );
}
