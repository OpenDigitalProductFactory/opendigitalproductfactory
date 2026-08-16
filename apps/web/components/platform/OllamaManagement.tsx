"use client";

import { useState, useTransition, useEffect } from "react";
import { InlineBusy } from "@/components/ui/InlineBusy";
import {
  listOllamaModels,
  getOllamaRunningModels,
  deleteOllamaModel,
  type OllamaModelInfo,
  type OllamaRunningModel,
} from "@/lib/actions/ollama-management";
import { discoverModels, profileModels } from "@/lib/actions/ai-providers";
import {
  detectLocalModelOverCommit,
  normaliseModelId,
} from "@/lib/inference/local-model-policy";

// ── Model Catalog ────────────────────────────────────────────────────────────

type CatalogModel = {
  id: string;
  name: string;
  description: string;
  vramGb: number;
  contextK: number;
  toolUse: boolean;
  tier: "strong" | "adequate";
  category: "coworkers" | "coding" | "embeddings" | "general";
  recommended?: boolean;
};

const CATALOG: CatalogModel[] = [
  // Coworkers — tool-use optimised. Tags match Docker Hub exactly (case-
  // sensitive, with quantization suffix). Verified against
  // https://hub.docker.com/r/ai/qwen3/tags on 2026-05-23. Earlier shortened
  // forms (`ai/qwen3:8b` etc.) 404 against Docker Model Runner — the Copy
  // button copies the literal `id` here so the tag MUST be a real published
  // tag, not a marketing-friendly short form.
  {
    id: "ai/qwen3:8B-Q4_K_M",
    name: "Qwen3 8B",
    description: "Best tool-calling accuracy for coworkers. Matches cloud Haiku (F1 0.93) — runs on most GPUs.",
    vramGb: 6,
    contextK: 32,
    toolUse: true,
    tier: "strong",
    category: "coworkers",
    recommended: true,
  },
  {
    id: "ai/qwen3:14B-Q6_K",
    name: "Qwen3 14B",
    description: "Top local model for tool calling (F1 0.97). Exceeds Haiku — needs 12 GB VRAM or 24 GB unified memory.",
    vramGb: 12,
    contextK: 32,
    toolUse: true,
    tier: "strong",
    category: "coworkers",
  },
  {
    id: "hf.co/ggml-org/Qwen3.8-27B-GGUF:Q4_K_M",
    name: "Qwen3.8 27B (dense)",
    description: "The most thorough local model. Slower to answer than the mixture-of-experts models here, and more complete when it does. Remembers very long conversations. ~18 GB, so you want 24 GB+ of graphics memory or a 32 GB+ Mac. It can read images, but DPF cannot send it picture questions yet.",
    vramGb: 18,
    contextK: 262,
    toolUse: true,
    tier: "strong",
    category: "coworkers",
  },
  {
    id: "ai/qwen3.6:35B-A3B-UD-Q4_K_M",
    name: "Qwen3.6 35B-A3B (MoE, 3B active)",
    description: "The fast alternative to Qwen3.8 27B. Replies arrive several times sooner, at some cost to thoroughness on long, multi-step tasks. ~22 GB, so you want 24 GB+ of graphics memory or a 32 GB+ Mac.",
    vramGb: 22,
    contextK: 32,
    toolUse: true,
    tier: "strong",
    category: "coworkers",
  },
  // Coding
  {
    id: "ai/qwen2.5-coder:14b",
    name: "Qwen2.5 Coder 14B",
    description: "Coding-specialised with 128K context. Strong tool use and structured output for code tasks.",
    vramGb: 10,
    contextK: 128,
    toolUse: true,
    tier: "strong",
    category: "coding",
  },
  {
    id: "ai/qwen2.5-coder:7b",
    name: "Qwen2.5 Coder 7B",
    description: "Lighter coding model. 6 GB VRAM, 128K context — good for autocomplete and small refactors.",
    vramGb: 6,
    contextK: 128,
    toolUse: true,
    tier: "adequate",
    category: "coding",
  },
  // Embeddings
  {
    id: "ai/nomic-embed-text-v1.5",
    name: "Nomic Embed Text v1.5",
    description: "768-dim embeddings for semantic search and memory. Required for full DPF memory features.",
    vramGb: 1,
    contextK: 8,
    toolUse: false,
    tier: "adequate",
    category: "embeddings",
    recommended: true,
  },
  // General / lightweight
  {
    id: "ai/qwen3:4B-UD-Q4_K_XL",
    name: "Qwen3 4B",
    description: "CPU-friendly lightweight model. 3 GB VRAM — for systems without a dedicated GPU.",
    vramGb: 3,
    contextK: 32,
    toolUse: true,
    tier: "adequate",
    category: "general",
  },
  {
    id: "ai/gemma4",
    name: "Gemma 4 (31B)",
    description: "Google's large open model. Good generalist but weaker tool calling than Qwen3 — needs 20 GB VRAM.",
    vramGb: 20,
    contextK: 128,
    toolUse: true,
    tier: "adequate",
    category: "general",
  },
];

const CATEGORIES = [
  { key: "coworkers", label: "Coworkers" },
  { key: "coding", label: "Coding" },
  { key: "embeddings", label: "Embeddings" },
  { key: "general", label: "General" },
  { key: "all", label: "All" },
] as const;

type Category = "all" | "coworkers" | "coding" | "embeddings" | "general";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fitsHardware(model: CatalogModel, vramGb: number | null): "fits" | "marginal" | "too-large" {
  if (vramGb === null || vramGb === 0) return "fits"; // unknown — don't restrict
  if (model.vramGb <= vramGb * 0.85) return "fits";
  if (model.vramGb <= vramGb) return "marginal";
  return "too-large";
}

// normaliseModelId is imported from local-model-policy (single source of truth).

// ── Component ────────────────────────────────────────────────────────────────

type Props = {
  canWrite: boolean;
  vramGb?: number | null;
  // Provider whose models are managed by this panel. Required to route the
  // post-list discover+profile sync through the right provider. Optional for
  // backward compat: when omitted, refresh() only reloads the displayed list
  // (legacy behaviour, BI-INST-004 unfixed).
  providerId?: string;
};

export function OllamaManagement({ canWrite, vramGb, providerId }: Props) {
  const [models, setModels] = useState<OllamaModelInfo[]>([]);
  const [running, setRunning] = useState<OllamaRunningModel[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleteCliCmd, setDeleteCliCmd] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [loaded, setLoaded] = useState(false);
  const [catalogCategory, setCatalogCategory] = useState<Category>("coworkers");
  const [copied, setCopied] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedInput, setAdvancedInput] = useState("");
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  // Initial load: just reload the displayed list. Skip the discover+profile
  // sync on first mount to avoid redundant work (the parent page-level Sync
  // Models & Profiles button already fires on user demand).
  useEffect(() => { refreshList(); }, []);

  // Reloads the displayed list only — used by useEffect on mount and as the
  // last step of refresh() after the sync completes.
  function refreshList() {
    startTransition(async () => {
      const [modelsResult, runningResult] = await Promise.all([
        listOllamaModels(),
        getOllamaRunningModels(),
      ]);
      setModels(modelsResult.models);
      setRunning(runningResult.models);
      setError(modelsResult.error ?? runningResult.error ?? null);
      setLoaded(true);
    });
  }

  // BI-INST-004: the visible Refresh button now ALSO runs discoverModels +
  // profileModels so newly-pulled models become routable. Previously only
  // refreshed the displayed list, which left ModelProfile rows stale and
  // confused users who expected "Refresh" to make new models usable.
  // Sync is a no-op when providerId isn't passed (legacy callers).
  function refresh() {
    startTransition(async () => {
      if (providerId) {
        setSyncMessage("Discovering models...");
        const discovery = await discoverModels(providerId);
        if (discovery.discovered > 0) {
          setSyncMessage("Syncing routing profiles...");
          const profResult = await profileModels(providerId);
          setSyncMessage(profResult.error
            ? `Profile error: ${profResult.error}`
            : `${profResult.profiled} profiled, ${profResult.failed} failed`);
        } else {
          setSyncMessage("No models to sync");
        }
        // Auto-clear the status message after a short window so the panel
        // doesn't accumulate stale state.
        setTimeout(() => setSyncMessage(null), 4000);
      }

      const [modelsResult, runningResult] = await Promise.all([
        listOllamaModels(),
        getOllamaRunningModels(),
      ]);
      setModels(modelsResult.models);
      setRunning(runningResult.models);
      setError(modelsResult.error ?? runningResult.error ?? null);
      setLoaded(true);
    });
  }

  async function copyCommand(cmd: string, key: string) {
    try {
      await navigator.clipboard.writeText(cmd);
    } catch {
      // Clipboard not available in some contexts
    }
    setCopied(key);
    setTimeout(() => setCopied(null), 2500);
  }

  function handleDelete(modelName: string) {
    startTransition(async () => {
      const result = await deleteOllamaModel(modelName);
      if (result.success) {
        setDeleteConfirm(null);
        setDeleteCliCmd(null);
        refresh();
      } else {
        // Docker Model Runner requires CLI deletion — show the command
        setDeleteConfirm(null);
        setDeleteCliCmd(`docker model rm ${normaliseModelId(modelName)}`);
      }
    });
  }

  const totalSizeGb = models.reduce((sum, m) => sum + m.size, 0) / 1e9;
  const totalVramGb = running.reduce((sum, m) => sum + m.sizeVram, 0) / 1e9;

  const installedIds = new Set(models.map((m) => normaliseModelId(m.name)));

  // Single-generation-model policy: flag when more than one generation model is
  // installed (they over-commit the GPU — one llama-server per model, no DMR
  // concurrency cap). Source of truth: local-model-policy.ts.
  const overCommit = detectLocalModelOverCommit({
    installedModelIds: models.map((m) => normaliseModelId(m.name)),
    vramGb: vramGb ?? null,
  });
  const removeModels = models.filter((m) =>
    overCommit.removeCandidates.includes(normaliseModelId(m.name)),
  );

  const filteredCatalog = catalogCategory === "all"
    ? CATALOG
    : CATALOG.filter((m) => m.category === catalogCategory);

  const tierColor: Record<string, string> = {
    strong: "var(--dpf-success)",
    adequate: "var(--dpf-accent)",
  };

  return (
    <div>

      {/* ── Installed Models ─────────────────────────────────────────────── */}
      <div style={{
        background: "var(--dpf-surface-1)",
        border: "1px solid var(--dpf-border)",
        borderRadius: 8,
        padding: 20,
        marginBottom: 16,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--dpf-text)", margin: 0 }}>
            Installed Models
          </h2>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {syncMessage && (
              <span style={{ fontSize: 10, color: "var(--dpf-muted)" }}>{syncMessage}</span>
            )}
            <button
              type="button"
              onClick={refresh}
              disabled={isPending}
              title={providerId
                ? "Reload the list AND sync newly-pulled models into routing profiles."
                : "Reload the displayed list."}
              style={{
                fontSize: 11,
                padding: "4px 10px",
                borderRadius: 4,
                border: "1px solid var(--dpf-border)",
                background: "transparent",
                color: "var(--dpf-muted)",
                cursor: "pointer",
                opacity: isPending ? 0.5 : 1,
              }}
            >
              {isPending && syncMessage ? "Syncing..." : "Refresh"}
            </button>
          </div>
        </div>

        {/* Summary bar */}
        {loaded && (
          <div style={{
            display: "flex",
            gap: 16,
            marginBottom: 12,
            padding: "7px 10px",
            background: "color-mix(in srgb, var(--dpf-border) 20%, transparent)",
            borderRadius: 5,
            fontSize: 11,
          }}>
            <span><span style={{ color: "var(--dpf-muted)" }}>Models: </span><span style={{ fontWeight: 500 }}>{models.length}</span></span>
            <span><span style={{ color: "var(--dpf-muted)" }}>Disk: </span><span style={{ fontWeight: 500 }}>{totalSizeGb.toFixed(1)} GB</span></span>
            {running.length > 0 && (
              <span>
                <span style={{ color: "var(--dpf-muted)" }}>VRAM loaded: </span>
                <span style={{ color: "var(--dpf-success)", fontWeight: 500 }}>{totalVramGb.toFixed(1)} GB</span>
                <span style={{ color: "var(--dpf-muted)" }}> ({running.length})</span>
              </span>
            )}
          </div>
        )}

        {/* Over-commit warning: more than one generation model installed. */}
        {loaded && overCommit.overCommitted && (
          <div style={{
            marginBottom: 12,
            padding: "10px 12px",
            borderRadius: 5,
            border: "1px solid color-mix(in srgb, var(--dpf-warning, #d98300) 40%, var(--dpf-border))",
            background: "color-mix(in srgb, var(--dpf-warning, #d98300) 8%, transparent)",
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--dpf-text)", marginBottom: 4 }}>
              ⚠ More than one AI model is installed
            </div>
            <div style={{ fontSize: 11, color: "var(--dpf-muted)", lineHeight: 1.5 }}>
              {overCommit.reason}
            </div>
            {removeModels.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8, alignItems: "center" }}>
                {overCommit.recommendedKeep && (
                  <span style={{ fontSize: 10, color: "var(--dpf-muted)" }}>
                    Keep <code style={{ color: "var(--dpf-success)" }}>{normaliseModelId(overCommit.recommendedKeep)}</code> ·
                  </span>
                )}
                {canWrite && removeModels.map((m) => (
                  <button
                    key={m.name}
                    type="button"
                    onClick={() => handleDelete(m.name)}
                    disabled={isPending}
                    style={{
                      fontSize: 10, padding: "3px 8px", borderRadius: 3, cursor: "pointer",
                      border: "1px solid color-mix(in srgb, var(--dpf-error) 40%, transparent)",
                      background: "color-mix(in srgb, var(--dpf-error) 12%, transparent)",
                      color: "var(--dpf-error)",
                    }}
                  >
                    Remove {normaliseModelId(m.name)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {error && (
          <div style={{ color: "var(--dpf-error)", fontSize: 11, marginBottom: 10 }}>{error}</div>
        )}

        {/* Pending CLI delete instruction */}
        {deleteCliCmd && (
          <div style={{
            marginBottom: 12,
            padding: "10px 12px",
            borderRadius: 5,
            border: "1px solid color-mix(in srgb, var(--dpf-accent) 30%, var(--dpf-border))",
            background: "color-mix(in srgb, var(--dpf-accent) 6%, transparent)",
          }}>
            <div style={{ fontSize: 11, color: "var(--dpf-muted)", marginBottom: 6 }}>
              Run this command in your terminal, then click Refresh:
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <code style={{ flex: 1, fontSize: 11, fontFamily: "monospace", color: "var(--dpf-text)" }}>
                {deleteCliCmd}
              </code>
              <button
                type="button"
                onClick={() => copyCommand(deleteCliCmd, "delete-cmd")}
                style={{
                  fontSize: 10,
                  padding: "3px 8px",
                  borderRadius: 3,
                  border: "1px solid var(--dpf-border)",
                  background: copied === "delete-cmd" ? "color-mix(in srgb, var(--dpf-success) 15%, transparent)" : "transparent",
                  color: copied === "delete-cmd" ? "var(--dpf-success)" : "var(--dpf-muted)",
                  cursor: "pointer",
                }}
              >
                {copied === "delete-cmd" ? "Copied!" : "Copy"}
              </button>
              <button
                type="button"
                onClick={() => setDeleteCliCmd(null)}
                style={{ fontSize: 10, padding: "3px 6px", borderRadius: 3, border: "none", background: "transparent", color: "var(--dpf-muted)", cursor: "pointer" }}
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {!loaded && isPending && (
          <div style={{ color: "var(--dpf-muted)", fontSize: 12, padding: "16px 0", display: "flex", justifyContent: "center" }}>
            <InlineBusy label="Loading models…" />
          </div>
        )}

        {loaded && models.length === 0 && (
          <div style={{ color: "var(--dpf-muted)", fontSize: 12, padding: "16px 0", textAlign: "center" }}>
            No models installed. Use the catalog below to add one.
          </div>
        )}

        {loaded && models.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {models.map((m) => {
              const isRunning = running.some((r) => r.name === m.name);
              const runInfo = running.find((r) => r.name === m.name);
              const normId = normaliseModelId(m.name);
              const catalogEntry = CATALOG.find((c) =>
                c.id === normId ||
                normId.startsWith(c.id.split(":")[0] ?? "") ||
                c.id === m.name,
              );

              return (
                <div
                  key={m.name}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    padding: "10px 12px",
                    borderRadius: 6,
                    background: isRunning
                      ? "color-mix(in srgb, var(--dpf-success) 5%, transparent)"
                      : "color-mix(in srgb, var(--dpf-border) 15%, transparent)",
                    border: `1px solid ${isRunning ? "color-mix(in srgb, var(--dpf-success) 20%, transparent)" : "var(--dpf-border)"}`,
                  }}
                >
                  <span style={{
                    width: 6, height: 6, borderRadius: "50%", flexShrink: 0, marginTop: 5,
                    background: isRunning ? "var(--dpf-success)" : "#555",
                  }} />

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12, fontWeight: 500, fontFamily: "monospace" }}>{m.name}</span>
                      {isRunning && (
                        <span style={{ fontSize: 9, color: "var(--dpf-success)", padding: "1px 4px", borderRadius: 3, background: "color-mix(in srgb, var(--dpf-success) 15%, transparent)" }}>
                          loaded
                        </span>
                      )}
                      {overCommit.removeCandidates.includes(normId) && (
                        <span style={{ fontSize: 9, color: "var(--dpf-warning, #d98300)", padding: "1px 4px", borderRadius: 3, background: "color-mix(in srgb, var(--dpf-warning, #d98300) 15%, transparent)" }}>
                          extra · over-commit
                        </span>
                      )}
                      {catalogEntry && (
                        <span style={{
                          fontSize: 9, padding: "1px 5px", borderRadius: 3, fontWeight: 600,
                          color: tierColor[catalogEntry.tier],
                          background: `color-mix(in srgb, ${tierColor[catalogEntry.tier]} 12%, transparent)`,
                        }}>
                          {catalogEntry.tier}
                        </span>
                      )}
                      {catalogEntry?.toolUse && (
                        <span style={{ fontSize: 9, color: "var(--dpf-success)", padding: "1px 4px", borderRadius: 3, background: "color-mix(in srgb, var(--dpf-success) 10%, transparent)" }}>
                          Tool Use
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 10, fontSize: 10, color: "var(--dpf-muted)", marginTop: 2 }}>
                      {m.parameterSize && <span>{m.parameterSize}</span>}
                      {m.quantization && <span>{m.quantization}</span>}
                      <span>{m.sizeGb} GB on disk</span>
                      {runInfo && <span style={{ color: "var(--dpf-success)" }}>VRAM: {runInfo.sizeVramGb} GB</span>}
                      {catalogEntry?.contextK && catalogEntry.contextK >= 128 && (
                        <span>{catalogEntry.contextK}K ctx</span>
                      )}
                    </div>
                  </div>

                  {canWrite && (
                    deleteConfirm === m.name ? (
                      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                        <button
                          type="button"
                          onClick={() => handleDelete(m.name)}
                          disabled={isPending}
                          style={{
                            fontSize: 10, padding: "3px 8px", borderRadius: 3, cursor: "pointer",
                            border: "1px solid color-mix(in srgb, var(--dpf-error) 50%, transparent)",
                            background: "color-mix(in srgb, var(--dpf-error) 15%, transparent)",
                            color: "var(--dpf-error)",
                          }}
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirm(null)}
                          style={{
                            fontSize: 10, padding: "3px 8px", borderRadius: 3, cursor: "pointer",
                            border: "1px solid var(--dpf-border)", background: "transparent", color: "var(--dpf-muted)",
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setDeleteConfirm(m.name)}
                        disabled={isPending}
                        style={{
                          fontSize: 10, padding: "3px 8px", borderRadius: 3, cursor: "pointer", flexShrink: 0,
                          border: "1px solid color-mix(in srgb, var(--dpf-error) 20%, transparent)",
                          background: "transparent", color: "var(--dpf-error)", opacity: 0.6,
                        }}
                      >
                        Delete
                      </button>
                    )
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Model Catalog ─────────────────────────────────────────────────── */}
      <div style={{
        background: "var(--dpf-surface-1)",
        border: "1px solid var(--dpf-border)",
        borderRadius: 8,
        padding: 20,
        marginBottom: 16,
      }}>
        <div style={{ marginBottom: 14 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--dpf-text)", margin: "0 0 3px 0" }}>
            Model Catalog
          </h2>
          <p style={{ fontSize: 11, color: "var(--dpf-muted)", margin: 0 }}>
            Copy the pull command, run it in your terminal, then click Refresh.
          </p>
        </div>

        {/* Hardware context */}
        {vramGb !== null && vramGb !== undefined && vramGb > 0 && (
          <div style={{
            fontSize: 11, marginBottom: 12, padding: "6px 10px",
            background: "color-mix(in srgb, var(--dpf-accent) 8%, transparent)",
            borderRadius: 4,
            borderLeft: "2px solid var(--dpf-accent)",
            color: "var(--dpf-muted)",
          }}>
            Detected {vramGb} GB VRAM — dimmed models exceed your hardware capacity.
          </div>
        )}

        {/* Category tabs */}
        <div style={{ display: "flex", gap: 0, marginBottom: 14, borderBottom: "1px solid var(--dpf-border)" }}>
          {CATEGORIES.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setCatalogCategory(key as Category)}
              style={{
                fontSize: 11, padding: "5px 13px",
                border: "1px solid",
                borderRadius: "4px 4px 0 0",
                borderBottom: "none",
                marginBottom: -1,
                borderColor: catalogCategory === key ? "var(--dpf-border)" : "transparent",
                background: catalogCategory === key ? "var(--dpf-surface-1)" : "transparent",
                color: catalogCategory === key ? "var(--dpf-text)" : "var(--dpf-muted)",
                cursor: "pointer",
                fontWeight: catalogCategory === key ? 500 : 400,
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Model cards */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filteredCatalog.map((model) => {
            const fit = fitsHardware(model, vramGb ?? null);
            const showHardwareHint = (vramGb ?? 0) > 0;
            const isInstalled = installedIds.has(model.id) || installedIds.has(model.id.split(":")[0] ?? "");
            const pullKey = `pull-${model.id}`;
            const isCopied = copied === pullKey;

            return (
              <div
                key={model.id}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  padding: "12px 14px",
                  borderRadius: 6,
                  border: `1px solid ${
                    isInstalled
                      ? "color-mix(in srgb, var(--dpf-accent) 25%, var(--dpf-border))"
                      : showHardwareHint && fit === "fits"
                      ? "color-mix(in srgb, var(--dpf-success) 15%, var(--dpf-border))"
                      : "var(--dpf-border)"
                  }`,
                  background: isInstalled
                    ? "color-mix(in srgb, var(--dpf-accent) 5%, transparent)"
                    : "color-mix(in srgb, var(--dpf-border) 10%, transparent)",
                  opacity: showHardwareHint && fit === "too-large" ? 0.45 : 1,
                }}
              >
                {/* Recommended star */}
                <div style={{
                  fontSize: 13, flexShrink: 0, marginTop: 1, width: 14,
                  color: model.recommended ? "var(--dpf-accent)" : "transparent",
                }}>
                  ★
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* Name + badges */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 3 }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{model.name}</span>
                    <span style={{
                      fontSize: 9, padding: "1px 5px", borderRadius: 3, fontWeight: 600,
                      color: tierColor[model.tier],
                      background: `color-mix(in srgb, ${tierColor[model.tier]} 12%, transparent)`,
                    }}>
                      {model.tier}
                    </span>
                    <span style={{ fontSize: 10, color: "var(--dpf-muted)" }}>
                      {model.vramGb} GB VRAM · {model.contextK}K ctx
                    </span>
                    {model.toolUse && (
                      <span style={{ fontSize: 9, color: "var(--dpf-success)", padding: "1px 4px", borderRadius: 3, background: "color-mix(in srgb, var(--dpf-success) 10%, transparent)" }}>
                        Tool Use
                      </span>
                    )}
                    {isInstalled && (
                      <span style={{ fontSize: 9, color: "var(--dpf-accent)", padding: "1px 4px", borderRadius: 3, background: "color-mix(in srgb, var(--dpf-accent) 15%, transparent)" }}>
                        Installed
                      </span>
                    )}
                  </div>

                  {/* Description */}
                  <p style={{ fontSize: 11, color: "var(--dpf-muted)", margin: "0 0 8px 0", lineHeight: 1.45 }}>
                    {model.description}
                  </p>

                  {/* Pull command row */}
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "5px 8px",
                    borderRadius: 4,
                    background: "color-mix(in srgb, var(--dpf-border) 25%, transparent)",
                    border: "1px solid color-mix(in srgb, var(--dpf-border) 50%, transparent)",
                  }}>
                    <code style={{
                      flex: 1,
                      fontSize: 10,
                      fontFamily: "monospace",
                      color: "var(--dpf-muted)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}>
                      docker model pull {model.id}
                    </code>
                    <button
                      type="button"
                      onClick={() => copyCommand(`docker model pull ${model.id}`, pullKey)}
                      style={{
                        fontSize: 10, padding: "3px 10px", borderRadius: 3, flexShrink: 0, cursor: "pointer",
                        border: "1px solid var(--dpf-border)",
                        background: isCopied
                          ? "color-mix(in srgb, var(--dpf-success) 15%, transparent)"
                          : "var(--dpf-surface-1)",
                        color: isCopied ? "var(--dpf-success)" : "var(--dpf-text)",
                        fontWeight: 500,
                      }}
                    >
                      {isCopied ? "Copied ✓" : "Copy"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Advanced: pull by name */}
        <details
          style={{ marginTop: 16 }}
          onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary style={{ fontSize: 11, color: "var(--dpf-muted)", cursor: "pointer", userSelect: "none" }}>
            Advanced: pull any model by name
          </summary>
          <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
            <input
              type="text"
              value={advancedInput}
              onChange={(e) => setAdvancedInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && advancedInput.trim()) {
                  copyCommand(`docker model pull ${advancedInput.trim()}`, "advanced");
                }
              }}
              placeholder="ai/qwen3:8b"
              style={{
                flex: 1, padding: "6px 10px", fontSize: 11, borderRadius: 4, fontFamily: "monospace",
                border: "1px solid var(--dpf-border)",
                background: "color-mix(in srgb, var(--dpf-border) 15%, transparent)",
                color: "var(--dpf-text)", outline: "none",
              }}
            />
            <button
              type="button"
              disabled={!advancedInput.trim()}
              onClick={() => {
                if (advancedInput.trim()) copyCommand(`docker model pull ${advancedInput.trim()}`, "advanced");
              }}
              style={{
                fontSize: 11, padding: "6px 12px", borderRadius: 4, cursor: "pointer",
                border: "1px solid var(--dpf-border)", background: "transparent", color: "var(--dpf-muted)",
                opacity: advancedInput.trim() ? 1 : 0.5,
              }}
            >
              {copied === "advanced" ? "Copied ✓" : "Copy command"}
            </button>
          </div>
          {advancedOpen && (
            <p style={{ fontSize: 10, color: "var(--dpf-muted)", margin: "6px 0 0 0" }}>
              Browse the full catalog at{" "}
              <a href="https://hub.docker.com/u/ai" target="_blank" rel="noreferrer" style={{ color: "var(--dpf-accent)" }}>
                hub.docker.com/u/ai
              </a>
            </p>
          )}
        </details>
      </div>
    </div>
  );
}
