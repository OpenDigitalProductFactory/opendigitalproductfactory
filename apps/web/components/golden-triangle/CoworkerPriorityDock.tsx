"use client";
// EP-GOLDEN-TRIANGLE — the per-coworker priority docked at the composer. Unlike
// the old header chip (a popover that clipped off the panel edge), this lives
// IN-FLOW just above the message input, so the triangle stays in view where you
// type and nothing overflows the window. Collapsible (default open) to reclaim
// space; the collapsed header still shows the colour-graded glyph + preset. Loads
// and saves THIS coworker's own posture (debounced), so each coworker remembers
// its priority and that posture tunes its runs.
import { useEffect, useRef, useState } from "react";

import type { GoldenTrianglePreference } from "@/lib/golden-triangle";

import { getCoworkerGoldenTrianglePosture, saveCoworkerGoldenTrianglePosture } from "@/lib/actions/golden-triangle";

import { GoldenTriangleControl } from "./GoldenTriangleControl";
import { GoldenTriangleGradient } from "./GoldenTriangleGradient";
import { PRESET_META, preferenceFromPreset } from "./posture-display";

export function CoworkerPriorityDock({ agentId }: { agentId: string }) {
  const [pref, setPref] = useState<GoldenTrianglePreference>(preferenceFromPreset("balanced"));
  const [collapsed, setCollapsed] = useState(false);
  const savedRef = useRef<string>(JSON.stringify(preferenceFromPreset("balanced")));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    getCoworkerGoldenTrianglePosture(agentId)
      .then((p) => {
        if (alive && p) {
          setPref(p);
          savedRef.current = JSON.stringify(p);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [agentId]);

  const activeLabel = pref.preset === "custom" ? "Custom" : PRESET_META[pref.preset].label;

  function onChange(next: GoldenTrianglePreference) {
    setPref(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    // Debounced per-coworker save (drag emits many changes; persist the settled one).
    timerRef.current = setTimeout(() => {
      const cur = JSON.stringify(next);
      if (cur !== savedRef.current) {
        savedRef.current = cur;
        saveCoworkerGoldenTrianglePosture(agentId, next).catch(() => {});
      }
    }, 800);
  }

  return (
    <div style={{ borderTop: "1px solid var(--dpf-border)", background: "color-mix(in srgb, var(--dpf-surface-2) 70%, transparent)" }}>
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        title="Priority for this coworker — cost, quality and time. Tunes how this coworker works."
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          background: "none",
          border: "none",
          padding: "7px 12px",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ width: 16, height: 14, flex: "0 0 auto", display: "inline-block" }} aria-hidden="true">
          <GoldenTriangleGradient qualityWeight={pref.qualityWeight} costWeight={pref.costWeight} timeWeight={pref.timeWeight} />
        </span>
        <span style={{ fontSize: 11, fontWeight: 500, color: "var(--dpf-text)" }}>Priority</span>
        <span style={{ fontSize: 11, color: "var(--dpf-muted)" }}>{activeLabel}</span>
        <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--dpf-muted)" }} aria-hidden="true">
          {collapsed ? "▸" : "▾"}
        </span>
      </button>
      {!collapsed && (
        <div style={{ padding: "0 12px 10px" }}>
          <GoldenTriangleControl
            value={pref}
            onChange={onChange}
            compact
            taskClass="conversation"
            authorityScopeKind="wsid"
          />
        </div>
      )}
    </div>
  );
}
