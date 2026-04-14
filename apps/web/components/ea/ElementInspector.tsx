"use client";

import { useState, useEffect } from "react";
import type { SerializedViewElement } from "@/lib/ea-types";
import { updateProposedProperties, removeElementFromView } from "@/lib/actions/ea";
import {
  getTraversalPatterns,
  runTraversal,
  type TraversalPatternInfo,
  type TraversalRunResult,
} from "@/lib/actions/ea-traversal";

type Props = {
  selected: SerializedViewElement | null;
  notationSlug: string;
  onUpdated: () => void;  // trigger parent refresh
};

export function ElementInspector({ selected, notationSlug, onUpdated }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Traversal state
  const [traversalOpen, setTraversalOpen] = useState(false);
  const [patterns, setPatterns] = useState<TraversalPatternInfo[]>([]);
  const [patternsLoaded, setPatternsLoaded] = useState(false);
  const [selectedPattern, setSelectedPattern] = useState<string>("");
  const [traversalResult, setTraversalResult] = useState<TraversalRunResult | null>(null);
  const [traversalRunning, setTraversalRunning] = useState(false);

  useEffect(() => {
    if (!selected) return;
    const overrides = selected.proposedProperties ?? {};
    setName(String(overrides["name"] ?? selected.element.name));
    setDescription(String(overrides["description"] ?? selected.element.description ?? ""));
    setConfirmDelete(false);
    setTraversalResult(null);
  }, [selected?.viewElementId]);

  // Load traversal patterns when the section is opened
  useEffect(() => {
    if (!traversalOpen || patternsLoaded) return;
    let cancelled = false;
    void getTraversalPatterns(notationSlug).then((result) => {
      if (cancelled) return;
      setPatterns(result);
      if (result.length > 0) {
        const first = result[0];
        if (first != null) setSelectedPattern(first.slug);
      }
      setPatternsLoaded(true);
    });
    return () => { cancelled = true; };
  }, [traversalOpen, patternsLoaded, notationSlug]);

  // Reset patterns cache when notation changes
  useEffect(() => {
    setPatternsLoaded(false);
    setPatterns([]);
    setSelectedPattern("");
  }, [notationSlug]);

  if (!selected) {
    return (
      <div style={{ width: 200, background: "var(--dpf-surface-1)", borderLeft: "1px solid var(--dpf-border)", padding: "10px 12px" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--dpf-accent)", textTransform: "uppercase" }}>Properties</div>
        <div style={{ fontSize: 10, color: "var(--dpf-muted)", marginTop: 4 }}>Nothing selected</div>
      </div>
    );
  }

  const isReadOnly = selected.mode === "reference";

  async function handleSave() {
    if (!selected || isReadOnly) return;
    setSaving(true);
    await updateProposedProperties({
      viewElementId: selected.viewElementId,
      properties: { name, description },
    });
    setSaving(false);
    onUpdated();
  }

  async function handleDelete() {
    if (!selected) return;
    if (!confirmDelete) { setConfirmDelete(true); return; }
    await removeElementFromView({ viewElementId: selected.viewElementId });
    onUpdated();
  }

  async function handleRunTraversal() {
    if (!selected || !selectedPattern) return;
    setTraversalRunning(true);
    setTraversalResult(null);
    const result = await runTraversal({
      patternSlug: selectedPattern,
      startElementIds: [selected.elementId],
      notationSlug,
    });
    setTraversalResult(result);
    setTraversalRunning(false);
  }

  return (
    <div style={{ width: 200, background: "var(--dpf-surface-1)", borderLeft: "1px solid var(--dpf-border)", display: "flex", flexDirection: "column", flexShrink: 0 }}>
      <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--dpf-border)" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--dpf-accent)", textTransform: "uppercase" }}>Properties</div>
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--dpf-text)", marginTop: 3 }}>{selected.element.name}</div>
        <div style={{ fontSize: 10, color: "var(--dpf-muted)" }}>{selected.elementType.name}</div>
        {isReadOnly && <div style={{ fontSize: 10, color: "#4a90d9", marginTop: 3 }}>Read-only reference</div>}
      </div>

      <div style={{ padding: "10px 10px", flex: 1, overflow: "auto" }}>
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: "var(--dpf-muted)", marginBottom: 2, textTransform: "uppercase" }}>Name</div>
          {isReadOnly
            ? <div style={{ fontSize: 11, color: "#ccd" }}>{selected.element.name}</div>
            : <input value={name} onChange={(e) => setName(e.target.value)}
                style={{ width: "100%", padding: "3px 5px", background: "var(--dpf-bg)", border: "1px solid var(--dpf-border)", borderRadius: 3, color: "var(--dpf-text)", fontSize: 11, boxSizing: "border-box" }} />
          }
        </div>

        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: "var(--dpf-muted)", marginBottom: 2, textTransform: "uppercase" }}>Stage</div>
          <div style={{ fontSize: 10, color: "#ccd" }}>{selected.element.lifecycleStage} / {selected.element.lifecycleStatus}</div>
        </div>

        {!isReadOnly && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: "var(--dpf-muted)", marginBottom: 2, textTransform: "uppercase" }}>Description</div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              style={{ width: "100%", padding: "3px 5px", background: "var(--dpf-bg)", border: "1px solid var(--dpf-border)", borderRadius: 3, color: "var(--dpf-text)", fontSize: 11, boxSizing: "border-box", resize: "none" }}
            />
          </div>
        )}

        {/* Traversal Run Panel */}
        <div style={{ borderTop: "1px solid var(--dpf-border)", marginTop: 4, paddingTop: 6 }}>
          <button
            onClick={() => setTraversalOpen(!traversalOpen)}
            style={{
              width: "100%",
              padding: "4px 0",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <span style={{ fontSize: 10, color: "var(--dpf-muted)", transform: traversalOpen ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s", display: "inline-block" }}>
              {">"}
            </span>
            <span style={{ fontSize: 10, fontWeight: 700, color: "var(--dpf-accent)", textTransform: "uppercase" }}>
              Run Traversal
            </span>
          </button>

          {traversalOpen && (
            <div style={{ marginTop: 6 }}>
              {patterns.length === 0 && patternsLoaded && (
                <div style={{ fontSize: 10, color: "var(--dpf-muted)" }}>No traversal patterns available</div>
              )}
              {patterns.length === 0 && !patternsLoaded && (
                <div style={{ fontSize: 10, color: "var(--dpf-muted)" }}>Loading...</div>
              )}
              {patterns.length > 0 && (
                <>
                  <select
                    value={selectedPattern}
                    onChange={(e) => { setSelectedPattern(e.target.value); setTraversalResult(null); }}
                    style={{
                      width: "100%",
                      padding: "3px 5px",
                      background: "var(--dpf-bg)",
                      border: "1px solid var(--dpf-border)",
                      borderRadius: 3,
                      color: "var(--dpf-text)",
                      fontSize: 10,
                      boxSizing: "border-box",
                      marginBottom: 4,
                    }}
                  >
                    {patterns.map((p) => (
                      <option key={p.slug} value={p.slug}>{p.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={handleRunTraversal}
                    disabled={traversalRunning || !selectedPattern}
                    style={{
                      width: "100%",
                      padding: 4,
                      background: "var(--dpf-accent)",
                      border: "none",
                      borderRadius: 3,
                      color: "#fff",
                      fontSize: 10,
                      fontWeight: 600,
                      cursor: traversalRunning ? "wait" : "pointer",
                      opacity: traversalRunning ? 0.7 : 1,
                    }}
                  >
                    {traversalRunning ? "Running..." : "Run"}
                  </button>
                </>
              )}

              {traversalResult != null && (
                <div style={{ marginTop: 6 }}>
                  {!traversalResult.ok && (
                    <div style={{ fontSize: 10, color: "#ff4444" }}>
                      {traversalResult.error ?? "Traversal failed"}
                    </div>
                  )}
                  {traversalResult.ok && traversalResult.paths != null && (
                    <div>
                      <div style={{ fontSize: 9, color: "var(--dpf-muted)", marginBottom: 3 }}>
                        {traversalResult.summary?.nodesTraversed ?? 0} nodes, {traversalResult.summary?.relationshipsFollowed ?? 0} rels
                      </div>
                      {traversalResult.paths.length === 0 && (
                        <div style={{ fontSize: 10, color: "var(--dpf-muted)" }}>No paths found</div>
                      )}
                      {traversalResult.paths.map((path, idx) => (
                        <div
                          key={idx}
                          style={{
                            fontSize: 10,
                            color: path.complete ? "var(--dpf-text)" : "var(--dpf-muted)",
                            padding: "3px 0",
                            borderBottom: "1px solid var(--dpf-border)",
                            lineHeight: 1.4,
                            wordBreak: "break-word",
                          }}
                        >
                          {path.label}
                          {!path.complete && (
                            <span style={{ fontSize: 9, color: "var(--dpf-warning)", marginLeft: 4 }}>
                              (incomplete)
                            </span>
                          )}
                        </div>
                      ))}
                      {traversalResult.summary != null && traversalResult.summary.refinementGaps.length > 0 && (
                        <div style={{ marginTop: 4 }}>
                          <div style={{ fontSize: 9, color: "var(--dpf-warning)", fontWeight: 600 }}>Refinement gaps:</div>
                          {traversalResult.summary.refinementGaps.map((gap, idx) => (
                            <div key={idx} style={{ fontSize: 9, color: "var(--dpf-warning)" }}>{gap}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {!isReadOnly && (
        <div style={{ padding: "6px 10px", borderTop: "1px solid var(--dpf-border)", display: "flex", flexDirection: "column", gap: 5 }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{ padding: 5, background: "var(--dpf-accent)", border: "none", borderRadius: 4, color: "#fff", fontSize: 10, fontWeight: 600, cursor: "pointer" }}
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
          <button
            onClick={handleDelete}
            style={{ padding: 5, background: "transparent", border: "1px solid #3a2a2a", borderRadius: 4, color: confirmDelete ? "#ff4444" : "#f87c7c", fontSize: 10, cursor: "pointer" }}
          >
            {confirmDelete ? "Confirm remove" : "Remove from view"}
          </button>
        </div>
      )}
    </div>
  );
}
