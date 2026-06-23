"use client";
// EP-GOLDEN-TRIANGLE Slice 2 — a small, self-contained posture area for the AI
// coworker dialog header. A balance-coloured chip (green centred → yellow → red
// as axes get starved) opens the compact control. View-local state for now;
// per-coworker persistence wires in with Slice 4.
import { useState } from "react";

import type { GoldenTrianglePreference } from "@/lib/golden-triangle";

import { GoldenTriangleControl } from "./GoldenTriangleControl";
import { PRESET_META, balanceState, preferenceFromPreset } from "./posture-display";

export function CoworkerPriorityControl() {
  const [open, setOpen] = useState(false);
  const [pref, setPref] = useState<GoldenTrianglePreference>(preferenceFromPreset("balanced"));

  const balance = balanceState(pref.qualityWeight, pref.costWeight, pref.timeWeight);
  const activeLabel = pref.preset === "custom" ? "Custom" : PRESET_META[pref.preset].label;
  const color = `var(${balance.token})`;

  return (
    <div style={{ position: "relative" }} onMouseDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={`Priority: ${activeLabel} — ${balance.label}. Click to balance cost, quality and time for this coworker.`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          fontSize: 9,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--dpf-muted)",
          background: "transparent",
          border: "1px solid var(--dpf-border)",
          borderRadius: 999,
          padding: "2px 6px",
          cursor: "pointer",
          lineHeight: 1.2,
        }}
      >
        <span
          style={{ width: 8, height: 8, borderRadius: "50%", background: color, flex: "0 0 auto" }}
          aria-hidden="true"
        />
        Priority: {activeLabel}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Set work priority"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            left: 0,
            zIndex: 5,
            width: 320,
            maxWidth: "calc(100vw - 32px)",
            background: "var(--dpf-surface-1)",
            border: "1px solid var(--dpf-border)",
            borderRadius: 12,
            boxShadow: "0 10px 28px rgba(0,0,0,0.35)",
          }}
        >
          <GoldenTriangleControl
            value={pref}
            onChange={setPref}
            compact
            taskClass="conversation"
            authorityScopeKind="wwwd"
          />
        </div>
      )}
    </div>
  );
}
