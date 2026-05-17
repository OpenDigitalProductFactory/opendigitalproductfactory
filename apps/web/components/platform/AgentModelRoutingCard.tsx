"use client";

import { useState } from "react";
import Link from "next/link";
import { saveAgentModelConfig } from "@/lib/actions/agent-model-config";

type Provider = {
  providerId: string;
  name: string;
  models: Array<{ modelId: string; friendlyName: string; supportsToolUse: boolean }>;
};

type Props = {
  agentId: string;
  minimumTier: string;
  budgetClass: string;
  pinnedProviderId: string | null;
  pinnedModelId: string | null;
  lastModel: string | null;
  minimumCapabilities: Record<string, boolean>;
  providers: Provider[];
  canWrite: boolean;
};

const TIERS = [
  { value: "frontier", label: "Frontier", desc: "Best available" },
  { value: "strong",   label: "Strong",   desc: "Good for most tasks" },
  { value: "adequate", label: "Adequate", desc: "Basic tasks, cheapest cloud" },
  { value: "basic",    label: "Basic",    desc: "Local models only" },
];

const BUDGET_CLASSES = [
  { value: "quality_first",  label: "Quality first" },
  { value: "balanced",       label: "Balanced" },
  { value: "minimize_cost",  label: "Cost first" },
];

const TIER_COLOR: Record<string, string> = {
  frontier: "#a78bfa",
  strong:   "var(--dpf-success)",
  adequate: "var(--dpf-accent)",
  basic:    "var(--dpf-muted)",
};

export function AgentModelRoutingCard({
  agentId,
  minimumTier: initialTier,
  budgetClass: initialBudget,
  pinnedProviderId: initialProvider,
  pinnedModelId: initialModel,
  lastModel,
  minimumCapabilities,
  providers,
  canWrite,
}: Props) {
  const [tier, setTier] = useState(initialTier);
  const [budget, setBudget] = useState(initialBudget);
  const [pinnedProvider, setPinnedProvider] = useState(initialProvider);
  const [pinnedModel, setPinnedModel] = useState(initialModel);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const isDirty =
    tier !== initialTier ||
    budget !== initialBudget ||
    pinnedProvider !== initialProvider ||
    pinnedModel !== initialModel;

  async function handleSave() {
    setSaving(true);
    setError(null);
    const result = await saveAgentModelConfig(agentId, tier, budget, pinnedProvider, pinnedModel);
    setSaving(false);
    if (result.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } else {
      setError(result.error ?? "Save failed");
    }
  }

  const availableModels = providers
    .find((p) => p.providerId === pinnedProvider)
    ?.models ?? [];

  const pinnedModelProfile = availableModels.find((m) => m.modelId === pinnedModel);
  const showToolWarning =
    pinnedModelProfile !== null &&
    pinnedModelProfile !== undefined &&
    pinnedModelProfile.supportsToolUse === false &&
    minimumCapabilities.toolUse === true;

  const sel: React.CSSProperties = {
    padding: "5px 8px",
    fontSize: 12,
    borderRadius: 4,
    border: "1px solid var(--dpf-border)",
    background: "var(--dpf-surface-1)",
    color: "var(--dpf-text)",
    cursor: canWrite ? "pointer" : "not-allowed",
    opacity: canWrite ? 1 : 0.7,
  };

  return (
    <div style={{
      border: "1px solid var(--dpf-border)",
      borderRadius: 8,
      padding: "16px 20px",
      background: "var(--dpf-surface)",
    }}>
      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: "var(--dpf-muted)" }}>
          Routing policy for this coworker only.{" "}
          <Link
            href="/platform/ai/assignments"
            style={{ color: "var(--dpf-accent)", textDecoration: "none" }}
          >
            Manage all coworkers →
          </Link>
        </div>
      </div>

      {/* Current model pill */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 10, color: "var(--dpf-muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Last served by
        </div>
        <div style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 10px",
          borderRadius: 5,
          background: "color-mix(in srgb, var(--dpf-border) 30%, transparent)",
          fontSize: 12,
          fontWeight: 500,
          color: lastModel ? "var(--dpf-text)" : "var(--dpf-muted)",
        }}>
          {pinnedProvider ? (
            <>
              <span style={{ fontSize: 9, color: "var(--dpf-accent)" }}>⬤</span>
              {pinnedModel ?? "pinned provider"} (pinned)
            </>
          ) : lastModel ? (
            <>
              <span style={{ fontSize: 9, color: "var(--dpf-success)" }}>⬤</span>
              {lastModel}
            </>
          ) : (
            <span style={{ fontStyle: "italic" }}>not yet invoked</span>
          )}
        </div>
      </div>

      {/* Tier + budget row */}
      <div style={{ display: "flex", gap: 20, marginBottom: 14, flexWrap: "wrap" }}>
        <div>
          <label style={{ display: "block", fontSize: 10, color: "var(--dpf-muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Minimum tier
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <select
              value={tier}
              onChange={(e) => setTier(e.target.value)}
              disabled={!canWrite || !!pinnedProvider}
              style={sel}
            >
              {TIERS.map((t) => (
                <option key={t.value} value={t.value}>{t.label} — {t.desc}</option>
              ))}
            </select>
            <span style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: TIER_COLOR[tier] ?? "var(--dpf-muted)",
              flexShrink: 0,
            }} />
          </div>
          {pinnedProvider && (
            <div style={{ fontSize: 10, color: "var(--dpf-muted)", marginTop: 3 }}>
              Tier ignored — provider pinned
            </div>
          )}
        </div>

        <div>
          <label style={{ display: "block", fontSize: 10, color: "var(--dpf-muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Budget
          </label>
          <select
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            disabled={!canWrite}
            style={sel}
          >
            {BUDGET_CLASSES.map((b) => (
              <option key={b.value} value={b.value}>{b.label}</option>
            ))}
          </select>
        </div>

        {Object.keys(minimumCapabilities).length > 0 && (
          <div>
            <div style={{ fontSize: 10, color: "var(--dpf-muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Required capabilities
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {minimumCapabilities.toolUse && (
                <span style={{ fontSize: 10, padding: "3px 7px", borderRadius: 4, background: "color-mix(in srgb, var(--dpf-success) 10%, transparent)", color: "var(--dpf-success)", border: "1px solid color-mix(in srgb, var(--dpf-success) 25%, transparent)" }}>
                  Tool use ✓
                </span>
              )}
              {minimumCapabilities.imageInput && (
                <span style={{ fontSize: 10, padding: "3px 7px", borderRadius: 4, background: "color-mix(in srgb, var(--dpf-accent) 10%, transparent)", color: "var(--dpf-accent)", border: "1px solid color-mix(in srgb, var(--dpf-accent) 25%, transparent)" }}>
                  Image input
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Advanced pin section */}
      {canWrite && (
        <div style={{ marginBottom: 14 }}>
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            style={{
              fontSize: 11,
              color: "var(--dpf-muted)",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <span style={{ fontSize: 9 }}>{showAdvanced ? "▾" : "▸"}</span>
            Pin to specific provider or model
            {pinnedProvider && (
              <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 3, background: "color-mix(in srgb, var(--dpf-accent) 15%, transparent)", color: "var(--dpf-accent)", marginLeft: 4 }}>
                pinned
              </span>
            )}
          </button>

          {showAdvanced && (
            <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", paddingLeft: 12, borderLeft: "2px solid var(--dpf-border)" }}>
              <div>
                <label style={{ display: "block", fontSize: 10, color: "var(--dpf-muted)", marginBottom: 4 }}>Provider</label>
                <select
                  value={pinnedProvider ?? ""}
                  onChange={(e) => {
                    setPinnedProvider(e.target.value || null);
                    setPinnedModel(null);
                  }}
                  style={sel}
                >
                  <option value="">Auto-route (no pin)</option>
                  {providers.map((p) => (
                    <option key={p.providerId} value={p.providerId}>{p.name}</option>
                  ))}
                </select>
              </div>

              {pinnedProvider && availableModels.length > 0 && (
                <div>
                  <label style={{ display: "block", fontSize: 10, color: "var(--dpf-muted)", marginBottom: 4 }}>Model</label>
                  <select
                    value={pinnedModel ?? ""}
                    onChange={(e) => setPinnedModel(e.target.value || null)}
                    style={sel}
                  >
                    <option value="">Any model from this provider</option>
                    {availableModels.map((m) => (
                      <option key={m.modelId} value={m.modelId}>{m.friendlyName || m.modelId}</option>
                    ))}
                  </select>
                </div>
              )}

              {pinnedProvider && (
                <div style={{ display: "flex", alignItems: "flex-end" }}>
                  <button
                    type="button"
                    onClick={() => { setPinnedProvider(null); setPinnedModel(null); }}
                    style={{
                      fontSize: 11, padding: "5px 10px", borderRadius: 4, cursor: "pointer",
                      border: "1px solid color-mix(in srgb, var(--dpf-error) 30%, var(--dpf-border))",
                      background: "transparent", color: "var(--dpf-error)",
                    }}
                  >
                    Clear pin
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {showToolWarning && (
        <div style={{
          marginBottom: 12, padding: "8px 12px", borderRadius: 4, fontSize: 11,
          background: "color-mix(in srgb, var(--dpf-warning) 10%, transparent)",
          border: "1px solid color-mix(in srgb, var(--dpf-warning) 30%, transparent)",
          color: "var(--dpf-warning)",
        }}>
          ⚠ Pinned model does not support tool use, but this coworker requires it.
        </div>
      )}

      {error && (
        <div style={{ marginBottom: 10, fontSize: 11, color: "var(--dpf-error)" }}>{error}</div>
      )}

      {/* Save row */}
      {canWrite && (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !isDirty}
            style={{
              fontSize: 12, padding: "6px 16px", borderRadius: 5, cursor: isDirty ? "pointer" : "default",
              border: "1px solid color-mix(in srgb, var(--dpf-accent) 40%, transparent)",
              background: isDirty ? "color-mix(in srgb, var(--dpf-accent) 12%, transparent)" : "transparent",
              color: isDirty ? "var(--dpf-accent)" : "var(--dpf-muted)",
              opacity: saving ? 0.6 : 1,
              fontWeight: 500,
            }}
          >
            {saving ? "Saving…" : saved ? "Saved ✓" : "Save"}
          </button>
          {!isDirty && !saved && (
            <span style={{ fontSize: 11, color: "var(--dpf-muted)" }}>No changes</span>
          )}
        </div>
      )}
    </div>
  );
}
