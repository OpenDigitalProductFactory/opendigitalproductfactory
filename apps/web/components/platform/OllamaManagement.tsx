"use client";

import { useState, useTransition, useEffect } from "react";
import {
  listOllamaModels,
  getOllamaRunningModels,
  pullOllamaModel,
  deleteOllamaModel,
  type OllamaModelInfo,
  type OllamaRunningModel,
} from "@/lib/actions/ollama-management";

type Props = {
  canWrite: boolean;
};

export function OllamaManagement({ canWrite }: Props) {
  const [models, setModels] = useState<OllamaModelInfo[]>([]);
  const [running, setRunning] = useState<OllamaRunningModel[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pullName, setPullName] = useState("");
  const [pullStatus, setPullStatus] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [loaded, setLoaded] = useState(false);

  // Load models on mount
  useEffect(() => {
    refresh();
  }, []);

  function refresh() {
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

  function handlePull() {
    if (!pullName.trim()) return;
    const name = pullName.trim();
    setPullStatus(`Pulling ${name}...`);
    setPullName("");
    startTransition(async () => {
      const result = await pullOllamaModel(name);
      if (result.success) {
        setPullStatus(`${name} pulled successfully`);
        refresh();
      } else {
        setPullStatus(`Failed: ${result.error}`);
      }
      setTimeout(() => setPullStatus(null), 5000);
    });
  }

  function handleDelete(modelName: string) {
    startTransition(async () => {
      const result = await deleteOllamaModel(modelName);
      if (result.success) {
        setDeleteConfirm(null);
        refresh();
      } else {
        setError(`Delete failed: ${result.error}`);
      }
    });
  }

  const totalSizeGb = models.reduce((sum, m) => sum + m.size, 0) / 1e9;
  const totalVramGb = running.reduce((sum, m) => sum + m.sizeVram, 0) / 1e9;

  return (
    <div style={{
      background: "#1a1a2e",
      border: "1px solid #2a2a40",
      borderRadius: 8,
      padding: 20,
      marginBottom: 16,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: "#fff", margin: 0 }}>
          Model Management
        </h2>
        <button
          type="button"
          onClick={refresh}
          disabled={isPending}
          style={{
            fontSize: 11,
            padding: "4px 10px",
            borderRadius: 4,
            border: "1px solid #2a2a40",
            background: "transparent",
            color: "#b0b0c8",
            cursor: "pointer",
            opacity: isPending ? 0.5 : 1,
          }}
        >
          Refresh
        </button>
      </div>

      {/* Summary bar */}
      {loaded && (
        <div style={{
          display: "flex",
          gap: 16,
          marginBottom: 16,
          padding: "8px 12px",
          background: "#161625",
          borderRadius: 6,
          fontSize: 11,
        }}>
          <div>
            <span style={{ color: "#b0b0c8" }}>Models: </span>
            <span style={{ color: "#fff", fontWeight: 500 }}>{models.length}</span>
          </div>
          <div>
            <span style={{ color: "#b0b0c8" }}>Disk: </span>
            <span style={{ color: "#fff", fontWeight: 500 }}>{totalSizeGb.toFixed(1)} GB</span>
          </div>
          {running.length > 0 && (
            <div>
              <span style={{ color: "#b0b0c8" }}>VRAM: </span>
              <span style={{ color: "#4ade80", fontWeight: 500 }}>{totalVramGb.toFixed(1)} GB</span>
              <span style={{ color: "#b0b0c8" }}> ({running.length} loaded)</span>
            </div>
          )}
        </div>
      )}

      {error && (
        <div style={{ color: "#ef4444", fontSize: 11, marginBottom: 12 }}>{error}</div>
      )}

      {pullStatus && (
        <div style={{
          fontSize: 11,
          padding: "6px 10px",
          borderRadius: 4,
          marginBottom: 12,
          background: pullStatus.startsWith("Failed") ? "rgba(239,68,68,0.1)" : "rgba(74,222,128,0.1)",
          color: pullStatus.startsWith("Failed") ? "#ef4444" : "#4ade80",
          border: `1px solid ${pullStatus.startsWith("Failed") ? "rgba(239,68,68,0.3)" : "rgba(74,222,128,0.3)"}`,
        }}>
          {isPending && pullStatus.startsWith("Pulling") ? (
            <span className="animate-pulse">{pullStatus}</span>
          ) : pullStatus}
        </div>
      )}

      {/* Pull model input */}
      {canWrite && (
        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          <input
            type="text"
            value={pullName}
            onChange={(e) => setPullName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handlePull(); }}
            placeholder="Model name (e.g. llama3.1:8b, mistral:7b)"
            disabled={isPending}
            style={{
              flex: 1,
              padding: "6px 10px",
              fontSize: 12,
              borderRadius: 4,
              border: "1px solid #2a2a40",
              background: "#161625",
              color: "#fff",
              outline: "none",
            }}
          />
          <button
            type="button"
            onClick={handlePull}
            disabled={isPending || !pullName.trim()}
            style={{
              fontSize: 11,
              padding: "6px 14px",
              borderRadius: 4,
              border: "1px solid rgba(74,222,128,0.4)",
              background: "rgba(74,222,128,0.1)",
              color: "#4ade80",
              cursor: "pointer",
              opacity: isPending || !pullName.trim() ? 0.5 : 1,
            }}
          >
            Pull
          </button>
        </div>
      )}

      {/* Model list */}
      {!loaded && isPending && (
        <div style={{ color: "#b0b0c8", fontSize: 12, padding: "20px 0", textAlign: "center" }}>
          <span className="animate-pulse">Loading models...</span>
        </div>
      )}

      {loaded && models.length === 0 && (
        <div style={{ color: "#b0b0c8", fontSize: 12, padding: "20px 0", textAlign: "center" }}>
          No models installed. Pull a model to get started.
        </div>
      )}

      {loaded && models.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {models.map((m) => {
            const isRunning = running.some((r) => r.name === m.name);
            const runInfo = running.find((r) => r.name === m.name);
            return (
              <div
                key={m.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 10px",
                  borderRadius: 6,
                  background: isRunning ? "rgba(74,222,128,0.05)" : "transparent",
                  border: `1px solid ${isRunning ? "rgba(74,222,128,0.2)" : "#2a2a40"}`,
                }}
              >
                {/* Status dot */}
                <span style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: isRunning ? "#4ade80" : "#555",
                  flexShrink: 0,
                }} />

                {/* Model name + details */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 500, color: "#fff", fontFamily: "monospace" }}>
                      {m.name}
                    </span>
                    {isRunning && (
                      <span style={{ fontSize: 9, color: "#4ade80", padding: "1px 4px", borderRadius: 3, background: "rgba(74,222,128,0.15)" }}>
                        loaded
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 8, fontSize: 10, color: "#b0b0c8", marginTop: 2 }}>
                    {m.parameterSize && <span>{m.parameterSize}</span>}
                    {m.quantization && <span>{m.quantization}</span>}
                    <span>{m.sizeGb} GB</span>
                    {runInfo && <span style={{ color: "#4ade80" }}>VRAM: {runInfo.sizeVramGb} GB</span>}
                  </div>
                </div>

                {/* Delete button */}
                {canWrite && (
                  deleteConfirm === m.name ? (
                    <div style={{ display: "flex", gap: 4 }}>
                      <button
                        type="button"
                        onClick={() => handleDelete(m.name)}
                        disabled={isPending}
                        style={{
                          fontSize: 10,
                          padding: "3px 8px",
                          borderRadius: 3,
                          border: "1px solid rgba(239,68,68,0.5)",
                          background: "rgba(239,68,68,0.2)",
                          color: "#ef4444",
                          cursor: "pointer",
                        }}
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteConfirm(null)}
                        style={{
                          fontSize: 10,
                          padding: "3px 8px",
                          borderRadius: 3,
                          border: "1px solid #2a2a40",
                          background: "transparent",
                          color: "#b0b0c8",
                          cursor: "pointer",
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
                        fontSize: 10,
                        padding: "3px 8px",
                        borderRadius: 3,
                        border: "1px solid rgba(239,68,68,0.2)",
                        background: "transparent",
                        color: "#ef4444",
                        cursor: "pointer",
                        opacity: 0.6,
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
  );
}
