"use client";

import { useMemo, useState } from "react";
import { deleteOllamaModel, pullOllamaModel } from "@/lib/actions/ollama-management";
import { useBackgroundOperationObserver } from "@/lib/hooks/useBackgroundOperationObserver";
import { StatusBadge } from "@/components/ui/report-kit";
import type { LocalModelOperation, LocalModelStatusSnapshot } from "@/lib/inference/local-model-operations";
import {
  formatModelBytes,
  LOCAL_MODEL_CATALOG,
  localModelComparisonKey,
  type LocalModelCategory,
  type LocalCatalogModel,
} from "@/lib/inference/local-model-catalog";

type Props = { canWrite: boolean; vramGb?: number | null; providerId?: string };
type Category = LocalModelCategory | "all";

const EMPTY_SNAPSHOT: LocalModelStatusSnapshot = { observedAt: "", models: [], operations: [] };
const CATEGORIES: Array<{ key: Category; label: string }> = [
  { key: "coworkers", label: "Coworkers" },
  { key: "coding", label: "Coding" },
  { key: "embeddings", label: "Embeddings" },
  { key: "general", label: "General" },
  { key: "all", label: "All" },
];
const panelStyle = {
  background: "var(--dpf-surface-1)", border: "1px solid var(--dpf-border)",
  borderRadius: 10, padding: 20, marginBottom: 16,
} as const;
const secondaryButtonStyle = {
  border: "1px solid var(--dpf-border)", borderRadius: 5, background: "transparent",
  color: "var(--dpf-text)", cursor: "pointer", fontSize: 11, padding: "5px 10px",
} as const;

export function OllamaManagement({ canWrite, vramGb }: Props) {
  const observer = useBackgroundOperationObserver<LocalModelStatusSnapshot>({
    endpoint: "/api/platform/ai/local-models/status",
    eventType: "system:local-model",
    initialSnapshot: EMPTY_SNAPSHOT,
    isActive: (snapshot) => snapshot.operations.some(isActiveOperation),
  });
  const { models, operations } = observer.snapshot;
  const [category, setCategory] = useState<Category>("coworkers");
  const [removeReference, setRemoveReference] = useState<string | null>(null);
  const [busyReference, setBusyReference] = useState<string | null>(null);
  const [customReference, setCustomReference] = useState("");
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const installedKeys = useMemo(() => new Set(models.map((model) => model.comparisonKey)), [models]);
  const activeByKey = useMemo(() => new Map(
    operations.filter(isActiveOperation).map((operation) => [operation.comparisonKey, operation] as const),
  ), [operations]);
  const visibleCatalog = category === "all"
    ? LOCAL_MODEL_CATALOG
    : LOCAL_MODEL_CATALOG.filter((model) => model.category === category);
  const knownBytes = models.reduce((total, model) => total + (model.sizeBytes ?? 0), 0);
  const unknownSizeCount = models.filter((model) => model.sizeBytes === null).length;

  async function install(reference: string) {
    setBusyReference(reference);
    setActionMessage(null);
    const result = await pullOllamaModel(reference);
    setActionMessage(result.ok
      ? "Install started. You can leave this page while it downloads."
      : result.error);
    await observer.refresh();
    setBusyReference(null);
  }

  async function remove(reference: string) {
    setBusyReference(reference);
    setActionMessage(null);
    const result = await deleteOllamaModel(reference);
    if (!result.ok) setActionMessage(result.error);
    else {
      setActionMessage(result.data.reconciliationWarning ?? "Model removed.");
      setRemoveReference(null);
    }
    await observer.refresh();
    setBusyReference(null);
  }

  return (
    <section aria-label="Local model management">
      <div style={panelStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
          <div>
            <h2 style={{ color: "var(--dpf-text)", fontSize: 15, margin: 0 }}>Installed models</h2>
            <p style={{ color: "var(--dpf-muted)", fontSize: 11, margin: "4px 0 0" }}>
              {models.length} installed
              {knownBytes > 0 ? ` · ${formatModelBytes(knownBytes)} on disk` : ""}
              {unknownSizeCount > 0 ? ` · ${unknownSizeCount} size unavailable` : ""}
            </p>
          </div>
          <button type="button" onClick={() => void observer.refresh()} disabled={observer.pending} style={secondaryButtonStyle}>
            {observer.pending ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {(observer.error || actionMessage) && (
          <p role="status" style={{ color: observer.error ? "var(--dpf-error)" : "var(--dpf-muted)", fontSize: 11 }}>
            {observer.error ? "The installed model list could not be refreshed." : actionMessage}
          </p>
        )}

        {operations.some(isActiveOperation) && (
          <div aria-label="Active downloads" style={{ display: "grid", gap: 8, marginTop: 14 }}>
            {operations.filter(isActiveOperation).map((operation) => (
              <OperationProgress key={`${operation.jobId}:${operation.attempt}`} operation={operation} />
            ))}
          </div>
        )}
        {operations.filter((operation) => operation.status === "failed").slice(0, 2).map((operation) => (
          <p key={`${operation.jobId}:failed:${operation.attempt}`} role="alert"
            style={{ color: "var(--dpf-error)", fontSize: 11, margin: "10px 0 0" }}>
            {operation.modelReference}: {operation.error ?? "Install failed. Try again."}
          </p>
        ))}

        {models.length === 0 && !observer.pending ? (
          <p style={{ color: "var(--dpf-muted)", fontSize: 12, margin: "18px 0 2px" }}>
            No models are installed. Choose one below.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
            {models.map((model) => {
              const catalogModel = LOCAL_MODEL_CATALOG.find(
                (entry) => localModelComparisonKey(entry.id) === model.comparisonKey,
              );
              const displayName = catalogModel?.name ?? model.name;
              const isNomic = model.comparisonKey.includes("nomic-embed-text");
              const confirming = removeReference === model.name;
              return (
                <article key={model.name} style={{ border: "1px solid var(--dpf-border)", borderRadius: 7, padding: "11px 12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: "var(--dpf-text)", fontSize: 12, fontWeight: 600 }}>{displayName}</div>
                      <div style={{ color: "var(--dpf-muted)", fontSize: 10, marginTop: 3 }}>
                        <span>{model.sizeLabel ?? formatModelBytes(model.sizeBytes)}</span>
                        {model.parameterSize ? <span> · {model.parameterSize} parameters</span> : null}
                        {model.quantization ? <span> · {model.quantization.replace(/^MOSTLY_/, "")}</span> : null}
                      </div>
                      <div style={{ color: "var(--dpf-muted)", fontFamily: "monospace", fontSize: 9, marginTop: 4, overflowWrap: "anywhere" }}>
                        {model.name}
                      </div>
                    </div>
                    {canWrite && !confirming && (
                      <button type="button" aria-label={`Remove ${displayName}`} onClick={() => setRemoveReference(model.name)}
                        disabled={busyReference !== null} style={{ ...secondaryButtonStyle, color: "var(--dpf-error)", flexShrink: 0 }}>
                        Remove
                      </button>
                    )}
                  </div>
                  {confirming && (
                    <div role="alert" style={{ background: "color-mix(in srgb, var(--dpf-error) 7%, transparent)", border: "1px solid color-mix(in srgb, var(--dpf-error) 30%, var(--dpf-border))", borderRadius: 6, marginTop: 10, padding: 10 }}>
                      <div style={{ color: "var(--dpf-text)", fontSize: 11 }}>
                        {isNomic
                          ? "Semantic search and memory will stop until an embedding model is installed and routed."
                          : "Coworkers routed only to this model may be unavailable until routing refreshes."}
                      </div>
                      <div style={{ display: "flex", gap: 6, marginTop: 9 }}>
                        <button type="button" onClick={() => void remove(model.name)} disabled={busyReference === model.name}
                          style={{ ...secondaryButtonStyle, color: "var(--dpf-error)" }}>
                          {busyReference === model.name ? "Removing…" : "Confirm removal"}
                        </button>
                        <button type="button" onClick={() => setRemoveReference(null)} disabled={busyReference !== null} style={secondaryButtonStyle}>
                          Keep model
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>

      <div style={panelStyle}>
        <h2 style={{ color: "var(--dpf-text)", fontSize: 15, margin: 0 }}>Add a local model</h2>
        <p style={{ color: "var(--dpf-muted)", fontSize: 11, margin: "4px 0 12px" }}>
          DPF downloads, verifies, and adds the model to routing.
          {vramGb ? ` This system reports ${vramGb} GB graphics memory.` : ""}
        </p>
        <div role="tablist" aria-label="Model categories" style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 12 }}>
          {CATEGORIES.map((item) => (
            <button key={item.key} type="button" role="tab" aria-selected={category === item.key}
              onClick={() => setCategory(item.key)} style={{ ...secondaryButtonStyle,
                background: category === item.key ? "color-mix(in srgb, var(--dpf-accent) 12%, transparent)" : "transparent",
                color: category === item.key ? "var(--dpf-accent)" : "var(--dpf-muted)" }}>
              {item.label}
            </button>
          ))}
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          {visibleCatalog.map((model) => (
            <CatalogRow key={model.id} model={model}
              installed={installedKeys.has(localModelComparisonKey(model.id))}
              operation={activeByKey.get(localModelComparisonKey(model.id))}
              canWrite={canWrite} busy={busyReference === model.id}
              hardwareFit={vramGb ? model.vramGb <= vramGb : true}
              onInstall={() => void install(model.id)} />
          ))}
        </div>

        {canWrite && (
          <details style={{ marginTop: 14 }}>
            <summary style={{ color: "var(--dpf-muted)", cursor: "pointer", fontSize: 11 }}>Advanced model reference</summary>
            <div style={{ display: "flex", gap: 7, marginTop: 9 }}>
              <label style={{ flex: 1 }}>
                <span style={{ color: "var(--dpf-muted)", display: "block", fontSize: 10, marginBottom: 4 }}>Registry reference</span>
                <input value={customReference} onChange={(event) => setCustomReference(event.target.value)}
                  placeholder="hf.co/organization/model:quantization" style={{ background: "var(--dpf-surface-0)",
                    border: "1px solid var(--dpf-border)", borderRadius: 5, color: "var(--dpf-text)",
                    fontFamily: "monospace", fontSize: 11, padding: "7px 9px", width: "100%" }} />
              </label>
              <button type="button" onClick={() => void install(customReference.trim())}
                disabled={!customReference.trim() || busyReference !== null}
                style={{ ...secondaryButtonStyle, alignSelf: "flex-end" }}>Install</button>
            </div>
          </details>
        )}
      </div>
    </section>
  );
}

function OperationProgress({ operation }: { operation: LocalModelOperation }) {
  return (
    <div role="status" style={{ background: "color-mix(in srgb, var(--dpf-accent) 7%, transparent)",
      border: "1px solid color-mix(in srgb, var(--dpf-accent) 24%, var(--dpf-border))", borderRadius: 7, padding: "9px 11px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11 }}>
        <span style={{ color: "var(--dpf-text)", fontFamily: "monospace" }}>{operation.modelReference}</span>
        <span style={{ color: "var(--dpf-accent)", fontWeight: 600 }}>
          {operation.percent === null ? "Starting" : `${operation.percent}%`}
        </span>
      </div>
      <div style={{ color: "var(--dpf-muted)", fontSize: 10, marginTop: 4 }}>{operation.message ?? "Downloading"}</div>
      {operation.percent !== null && <progress value={operation.percent} max={100} style={{ marginTop: 7, width: "100%" }}>{operation.percent}%</progress>}
    </div>
  );
}

function CatalogRow({ model, installed, operation, canWrite, busy, hardwareFit, onInstall }: {
  model: LocalCatalogModel; installed: boolean; operation: LocalModelOperation | undefined;
  canWrite: boolean; busy: boolean; hardwareFit: boolean; onInstall: () => void;
}) {
  return (
    <article style={{ border: "1px solid var(--dpf-border)", borderRadius: 7, display: "flex", gap: 12,
      justifyContent: "space-between", opacity: hardwareFit ? 1 : 0.62, padding: "11px 12px" }}>
      <div>
        <div style={{ alignItems: "center", color: "var(--dpf-text)", display: "flex", flexWrap: "wrap", fontSize: 12, fontWeight: 600, gap: 6 }}>
          <span>{model.name}</span>
          {model.governanceRole === "high-trust-reviewer" && (
            <StatusBadge intent="accent" label="High-trust reviewer" uppercase={false} variant="soft" />
          )}
        </div>
        <div style={{ color: "var(--dpf-muted)", fontSize: 10, marginTop: 3 }}>
          {model.vramGb} GB graphics memory · {model.contextK}K context{model.toolUse ? " · Tool use" : ""}{!hardwareFit ? " · Exceeds detected memory" : ""}
        </div>
        <p style={{ color: "var(--dpf-muted)", fontSize: 11, lineHeight: 1.4, margin: "5px 0 0" }}>{model.description}</p>
      </div>
      <div style={{ alignItems: "center", display: "flex", flexShrink: 0 }}>
        {installed ? <span style={{ color: "var(--dpf-success)", fontSize: 10, fontWeight: 600 }}>Installed</span>
          : operation ? <span style={{ color: "var(--dpf-accent)", fontSize: 10, fontWeight: 600 }}>{operation.percent === null ? "Queued" : `${operation.percent}%`}</span>
          : canWrite ? <button type="button" aria-label={`Install ${model.name}`} onClick={onInstall} disabled={busy} style={secondaryButtonStyle}>{busy ? "Starting…" : "Install"}</button>
          : null}
      </div>
    </article>
  );
}

function isActiveOperation(operation: LocalModelOperation): boolean {
  return operation.status === "queued" || operation.status === "running";
}
