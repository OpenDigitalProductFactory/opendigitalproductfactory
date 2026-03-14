"use client";

import { useState, useEffect } from "react";
import { useFloating, autoPlacement, offset, FloatingPortal } from "@floating-ui/react";

type ElementPreview = {
  elementId: string;
  name: string;
  typeName: string;
  lifecycleStage: string;
  lifecycleStatus: string;
};

type Props = {
  element: ElementPreview;
  anchorEl: HTMLElement | null;  // ghost node DOM element to anchor to
  onConfirm: (mode: "reference" | "propose") => void;
  onCancel: () => void;
};

export function ReferencePopup({ element, anchorEl, onConfirm, onCancel }: Props) {
  const [selectedMode, setSelectedMode] = useState<"reference" | "propose">("reference");
  const { refs, floatingStyles } = useFloating({
    elements: { reference: anchorEl },
    placement: "top",
    middleware: [offset(8), autoPlacement({ allowedPlacements: ["top", "bottom", "top-start", "top-end"] })],
  });

  // Dismiss on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (refs.floating.current && !refs.floating.current.contains(e.target as Node)) {
        onCancel();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [refs.floating, onCancel]);

  // Dismiss on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onCancel]);

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        style={{
          ...floatingStyles,
          background: "#1a1a2e",
          border: "1px solid #4a90d9",
          borderRadius: 8,
          boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
          zIndex: 1000,
          width: 220,
        }}
      >
        <div style={{ padding: "10px 12px 6px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#e0e0ff", marginBottom: 1 }}>{element.name}</div>
          <div style={{ fontSize: 10, color: "#8888a0", marginBottom: 10 }}>
            {element.typeName} · {element.lifecycleStage} · {element.lifecycleStatus}
          </div>

          {(["reference", "propose"] as const).map((mode) => (
            <div
              key={mode}
              onClick={() => setSelectedMode(mode)}
              style={{
                padding: "7px 9px",
                background: selectedMode === mode ? "#0f1a2a" : "#0f0f1a",
                border: `1px solid ${selectedMode === mode ? "#4a90d9" : "#2a2a40"}`,
                borderRadius: 5,
                cursor: "pointer",
                marginBottom: 5,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                <span style={{ fontSize: 12 }}>{mode === "reference" ? "🔒" : "✏️"}</span>
                <span style={{ fontSize: 10, fontWeight: 600, color: mode === "reference" ? "#90c8ff" : "#7c8cf8" }}>
                  {mode === "reference" ? "Reference" : "Propose change"}
                </span>
              </div>
              <div style={{ fontSize: 10, color: "#667788" }}>
                {mode === "reference"
                  ? "Read-only anchor. Shows operational context."
                  : "Editable copy. Describe how it changes."}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 6, padding: "8px 12px", borderTop: "1px solid #2a2a40" }}>
          <button
            onClick={() => onConfirm(selectedMode)}
            style={{ flex: 1, padding: 5, background: "#4a90d9", border: "none", borderRadius: 4, color: "#fff", fontSize: 10, fontWeight: 600, cursor: "pointer" }}
          >
            Add to canvas
          </button>
          <button
            onClick={onCancel}
            style={{ padding: "5px 9px", background: "transparent", border: "1px solid #2a2a40", borderRadius: 4, color: "#8888a0", fontSize: 10, cursor: "pointer" }}
          >
            Cancel
          </button>
        </div>
      </div>
    </FloatingPortal>
  );
}
