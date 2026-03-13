"use client";

import { useState, useEffect } from "react";
import type { SerializedViewElement } from "@/lib/ea-types";
import { updateProposedProperties, removeElementFromView } from "@/lib/actions/ea";

type Props = {
  selected: SerializedViewElement | null;
  onUpdated: () => void;  // trigger parent refresh
};

export function ElementInspector({ selected, onUpdated }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!selected) return;
    const overrides = selected.proposedProperties ?? {};
    setName(String(overrides["name"] ?? selected.element.name));
    setDescription(String(overrides["description"] ?? selected.element.description ?? ""));
    setConfirmDelete(false);
  }, [selected?.viewElementId]);

  if (!selected) {
    return (
      <div style={{ width: 200, background: "#161625", borderLeft: "1px solid #2a2a40", padding: "10px 12px" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#7c8cf8", textTransform: "uppercase" }}>Properties</div>
        <div style={{ fontSize: 10, color: "#8888a0", marginTop: 4 }}>Nothing selected</div>
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

  return (
    <div style={{ width: 200, background: "#161625", borderLeft: "1px solid #2a2a40", display: "flex", flexDirection: "column", flexShrink: 0 }}>
      <div style={{ padding: "8px 10px", borderBottom: "1px solid #2a2a40" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#7c8cf8", textTransform: "uppercase" }}>Properties</div>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#e0e0ff", marginTop: 3 }}>{selected.element.name}</div>
        <div style={{ fontSize: 10, color: "#8888a0" }}>{selected.elementType.name}</div>
        {isReadOnly && <div style={{ fontSize: 10, color: "#4a90d9", marginTop: 3 }}>🔒 Read-only reference</div>}
      </div>

      <div style={{ padding: "10px 10px", flex: 1, overflow: "auto" }}>
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: "#8888a0", marginBottom: 2, textTransform: "uppercase" }}>Name</div>
          {isReadOnly
            ? <div style={{ fontSize: 11, color: "#ccd" }}>{selected.element.name}</div>
            : <input value={name} onChange={(e) => setName(e.target.value)}
                style={{ width: "100%", padding: "3px 5px", background: "#0f0f1a", border: "1px solid #2a2a40", borderRadius: 3, color: "#e0e0ff", fontSize: 11, boxSizing: "border-box" }} />
          }
        </div>

        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: "#8888a0", marginBottom: 2, textTransform: "uppercase" }}>Stage</div>
          <div style={{ fontSize: 10, color: "#ccd" }}>{selected.element.lifecycleStage} / {selected.element.lifecycleStatus}</div>
        </div>

        {!isReadOnly && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: "#8888a0", marginBottom: 2, textTransform: "uppercase" }}>Description</div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              style={{ width: "100%", padding: "3px 5px", background: "#0f0f1a", border: "1px solid #2a2a40", borderRadius: 3, color: "#e0e0ff", fontSize: 11, boxSizing: "border-box", resize: "none" }}
            />
          </div>
        )}
      </div>

      {!isReadOnly && (
        <div style={{ padding: "6px 10px", borderTop: "1px solid #2a2a40", display: "flex", flexDirection: "column", gap: 5 }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{ padding: 5, background: "#7c8cf8", border: "none", borderRadius: 4, color: "#fff", fontSize: 10, fontWeight: 600, cursor: "pointer" }}
          >
            {saving ? "Saving…" : "Save changes"}
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
