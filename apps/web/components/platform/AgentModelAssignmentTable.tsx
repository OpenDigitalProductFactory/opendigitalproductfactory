"use client";

import { useState } from "react";
import { saveAgentModelConfig } from "@/lib/actions/agent-model-config";
import type { AgentMinimumCapabilities } from "@/lib/routing/agent-capability-types";

type AgentRow = {
  agentId: string;
  agentName: string;
  minimumTier: string;
  budgetClass: string;
  pinnedProviderId: string | null;
  pinnedModelId: string | null;
  lastModel: string | null;
  isDbConfig: boolean;
  hasToolGrants: boolean;
  minimumCapabilities: AgentMinimumCapabilities | null;
};

type ProviderModel = { modelId: string; friendlyName: string; supportsToolUse: boolean };

type Provider = {
  providerId: string;
  name: string;
  models: Array<ProviderModel>;
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

function findPinnedModel(
  providers: Provider[],
  pinnedProviderId: string | null,
  pinnedModelId: string | null,
): ProviderModel | null {
  if (!pinnedProviderId || !pinnedModelId) return null;
  const provider = providers.find((p) => p.providerId === pinnedProviderId);
  return provider?.models.find((m) => m.modelId === pinnedModelId) ?? null;
}

export function AgentModelAssignmentTable({
  agents,
  providers,
  canWrite,
  capabilityGapCount,
}: {
  agents: AgentRow[];
  providers: Provider[];
  canWrite: boolean;
  capabilityGapCount: number;
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
      {capabilityGapCount > 0 && (
        <div
          className="mb-4 rounded-md border px-4 py-3 text-sm"
          style={{
            borderColor: "var(--dpf-warning)",
            backgroundColor: "color-mix(in srgb, var(--dpf-warning) 10%, var(--dpf-surface-1))",
            color: "var(--dpf-text)",
            marginBottom: 16,
            borderRadius: 6,
            border: "1px solid var(--dpf-warning)",
            padding: "12px 16px",
            fontSize: 13,
          }}
        >
          <span style={{ fontWeight: 600 }}>
            {capabilityGapCount} agent{capabilityGapCount > 1 ? "s" : ""}
          </span>
          {" "}have no eligible endpoints for their required capabilities.
          Check active providers at{" "}
          <a
            href="/platform/ai/providers"
            style={{ color: "var(--dpf-accent)", textDecoration: "underline" }}
          >
            Platform &gt; AI &gt; Providers
          </a>.
        </div>
      )}
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
          {rows.map((row) => {
            const pinnedModel = findPinnedModel(providers, row.pinnedProviderId, row.pinnedModelId);
            const showToolWarning = row.hasToolGrants && pinnedModel !== null && pinnedModel.supportsToolUse === false;
            return (
            <>
              <tr key={row.agentId}>
                <td style={cellStyle}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
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
                      {row.minimumCapabilities && Object.keys(row.minimumCapabilities).length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                          {(row.minimumCapabilities as AgentMinimumCapabilities).toolUse && (
                            <span
                              style={{
                                borderRadius: 4,
                                padding: "1px 6px",
                                fontSize: 11,
                                background: "color-mix(in srgb, var(--dpf-accent) 15%, transparent)",
                                color: "var(--dpf-accent)",
                              }}
                            >
                              Tools
                            </span>
                          )}
                          {(row.minimumCapabilities as AgentMinimumCapabilities).imageInput && (
                            <span
                              style={{
                                borderRadius: 4,
                                padding: "1px 6px",
                                fontSize: 11,
                                background: "color-mix(in srgb, var(--dpf-info) 15%, transparent)",
                                color: "var(--dpf-info)",
                              }}
                            >
                              Image
                            </span>
                          )}
                          {(row.minimumCapabilities as AgentMinimumCapabilities).pdfInput && (
                            <span
                              style={{
                                borderRadius: 4,
                                padding: "1px 6px",
                                fontSize: 11,
                                background: "color-mix(in srgb, var(--dpf-warning) 15%, transparent)",
                                color: "var(--dpf-warning)",
                              }}
                            >
                              PDF
                            </span>
                          )}
                          {(row.minimumCapabilities as AgentMinimumCapabilities).codeExecution && (
                            <span
                              style={{
                                borderRadius: 4,
                                padding: "1px 6px",
                                fontSize: 11,
                                background: "color-mix(in srgb, var(--dpf-success) 15%, transparent)",
                                color: "var(--dpf-success)",
                              }}
                            >
                              Code
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    {showToolWarning && (
                      <span
                        title="Pinned model does not support function calling — tools disabled"
                        style={{
                          display: "inline-block",
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: "var(--dpf-warning)",
                          flexShrink: 0,
                        }}
                      />
                    )}
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
                      <span style={{ fontSize: 10, color: "var(--dpf-success)" }}>Saved</span>
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
                    {showToolWarning && (
                      <div
                        style={{
                          marginTop: 12,
                          padding: "8px 12px",
                          borderRadius: 6,
                          border: "1px solid var(--dpf-warning)",
                          background: "color-mix(in srgb, var(--dpf-warning) 10%, var(--dpf-surface-1))",
                          color: "var(--dpf-text)",
                          fontSize: 12,
                          lineHeight: 1.5,
                        }}
                      >
                        ⚠ This model does not support function calling. Pinning it will disable all tools for this coworker — it will respond as a generic assistant with no capabilities or identity.
                      </div>
                    )}
                  </td>
                </tr>
              )}
            </>
            );
          })}
        </tbody>
      </table>
      <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 12 }}>
        Current Model shows the model the router selected last time this agent was invoked.
        Change Minimum Quality to influence selection.
      </p>
    </div>
  );
}
