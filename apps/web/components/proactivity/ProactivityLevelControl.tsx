"use client";

import { useState } from "react";

import { getProactivityLevelCopy, PROACTIVITY_LEVEL_COPY } from "@/lib/proactivity/proactivity-copy";
import { PROACTIVITY_LEVELS, type ProactivityLevel } from "@/lib/proactivity/proactivity-types";

import { ProactivityGaugeIcon } from "./ProactivityGaugeIcon";

export function ProactivityLevelControl({
  value,
  onChange,
}: {
  value: ProactivityLevel;
  onChange: (level: ProactivityLevel) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const copy = getProactivityLevelCopy(value);

  return (
    <div style={{ position: "relative", flex: "0 0 auto" }}>
      <button
        type="button"
        onClick={() => setExpanded((next) => !next)}
        aria-expanded={expanded}
        aria-label={`Proactivity ${copy.label}`}
        title={`${copy.label}: ${copy.description}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          minHeight: 30,
          background: "none",
          border: "none",
          borderLeft: "1px solid var(--dpf-border)",
          padding: "7px 12px",
          cursor: "pointer",
          textAlign: "left",
          whiteSpace: "nowrap",
        }}
      >
        <ProactivityGaugeIcon level={value} />
        <span style={{ fontSize: 11, fontWeight: 500, color: "var(--dpf-text)" }}>Proactivity</span>
        <span style={{ fontSize: 11, color: "var(--dpf-muted)" }}>{copy.label}</span>
      </button>
      {expanded && (
        <div
          role="group"
          aria-label="Choose proactivity level"
          style={{
            position: "absolute",
            right: 0,
            bottom: "calc(100% + 6px)",
            zIndex: 10,
            minWidth: 260,
            border: "1px solid var(--dpf-border)",
            borderRadius: 8,
            background: "var(--dpf-surface-1)",
            boxShadow: "0 12px 30px rgba(0,0,0,0.22)",
            padding: 6,
          }}
        >
          {PROACTIVITY_LEVELS.map((level) => {
            const option = PROACTIVITY_LEVEL_COPY[level];
            const selected = level === value;
            return (
              <button
                key={level}
                type="button"
                onClick={() => {
                  onChange(level);
                  setExpanded(false);
                }}
                aria-pressed={selected}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  border: selected ? "1px solid var(--dpf-accent)" : "1px solid transparent",
                  borderRadius: 6,
                  background: selected ? "var(--dpf-accent-soft)" : "transparent",
                  color: "var(--dpf-text)",
                  padding: "7px 8px",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <ProactivityGaugeIcon level={level} size={15} />
                <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{option.label}</span>
                  <span style={{ fontSize: 10, color: "var(--dpf-muted)", lineHeight: 1.25 }}>{option.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
