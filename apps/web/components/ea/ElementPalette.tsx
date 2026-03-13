"use client";

import { useState } from "react";
import { layerFromNeoLabel, LAYER_COLOURS } from "@/lib/ea-types";

type ElementType = {
  id: string;
  slug: string;
  name: string;
  neoLabel: string;
};

type Props = {
  elementTypes: ElementType[];          // filtered by viewpoint already
  onDragStart: (event: React.DragEvent, elementTypeId: string, elementTypeName: string) => void;
  onSearchExisting: () => void;
};

const LAYER_ORDER = ["business", "application", "technology"] as const;

export function ElementPalette({ elementTypes, onDragStart, onSearchExisting }: Props) {
  const [search, setSearch] = useState("");

  const filtered = elementTypes.filter((et) =>
    et.name.toLowerCase().includes(search.toLowerCase())
  );

  const grouped = LAYER_ORDER.map((layer) => ({
    layer,
    types: filtered.filter((et) => layerFromNeoLabel(et.neoLabel) === layer),
  })).filter((g) => g.types.length > 0);

  return (
    <div style={{ width: 180, background: "#161625", borderRight: "1px solid #2a2a40", display: "flex", flexDirection: "column", flexShrink: 0 }}>
      <div style={{ padding: "6px 10px", borderBottom: "1px solid #2a2a40" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search elements…"
          style={{ width: "100%", padding: "3px 6px", background: "#0f0f1a", border: "1px solid #2a2a40", borderRadius: 3, color: "#e0e0ff", fontSize: 11, boxSizing: "border-box" }}
        />
      </div>

      <div style={{ overflow: "auto", flex: 1, padding: "6px 0" }}>
        {grouped.map(({ layer, types }) => {
          const colours = LAYER_COLOURS[layer]!;
          return (
            <div key={layer}>
              <div style={{ padding: "3px 10px 1px", fontSize: 8, fontWeight: 700, color: "#555566", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {layer}
              </div>
              {types.map((et) => (
                <div
                  key={et.id}
                  draggable
                  onDragStart={(e) => onDragStart(e, et.id, et.name)}
                  style={{ padding: "3px 10px", fontSize: 11, color: "#ccd", cursor: "grab", display: "flex", alignItems: "center", gap: 5 }}
                >
                  <span style={{ width: 9, height: 9, background: colours.bg, border: `1px solid ${colours.border}`, borderRadius: 1, flexShrink: 0, display: "inline-block" }} />
                  {et.name}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {/* ExistingElementSearch is deferred to Phase EA-3. Button is disabled for now. */}
      <div style={{ padding: "6px 10px", borderTop: "1px solid #2a2a40" }}>
        <button
          onClick={onSearchExisting}
          disabled
          title="Search existing elements — coming in Phase EA-3"
          style={{ width: "100%", padding: 4, background: "#1a1a2e", border: "1px dashed #555566", borderRadius: 3, color: "#555566", fontSize: 11, cursor: "not-allowed", opacity: 0.5 }}
        >
          + Search existing…
        </button>
      </div>
    </div>
  );
}
