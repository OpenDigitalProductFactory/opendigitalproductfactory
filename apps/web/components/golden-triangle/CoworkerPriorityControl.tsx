"use client";
// EP-GOLDEN-TRIANGLE — the per-coworker priority chip for the AI coworker header.
// Compact at rest (a small colour-graded triangle glyph + label), it expands to
// the full control on click and AUTO-COLLAPSES on click-away / Done — replacing
// the model + effort pickers with one higher-level control. It loads and saves
// THIS coworker's own posture (per-agent), so each coworker remembers its
// priority and that posture tunes its runs.
import { useEffect, useRef, useState } from "react";

import type { GoldenTrianglePreference } from "@/lib/golden-triangle";

import { getCoworkerGoldenTrianglePosture, saveCoworkerGoldenTrianglePosture } from "@/lib/actions/golden-triangle";

import { GoldenTriangleControl } from "./GoldenTriangleControl";
import { GoldenTriangleGradient } from "./GoldenTriangleGradient";
import { PRESET_META, preferenceFromPreset } from "./posture-display";

export function CoworkerPriorityControl({ agentId }: { agentId: string }) {
  const [open, setOpen] = useState(false);
  const [pref, setPref] = useState<GoldenTrianglePreference>(preferenceFromPreset("balanced"));
  const savedRef = useRef<string>(JSON.stringify(preferenceFromPreset("balanced")));
  const rootRef = useRef<HTMLDivElement>(null);
  const prefRef = useRef(pref);
  prefRef.current = pref;

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
    };
  }, [agentId]);

  const activeLabel = pref.preset === "custom" ? "Custom" : PRESET_META[pref.preset].label;

  function close() {
    setOpen(false);
    const cur = JSON.stringify(prefRef.current);
    if (cur !== savedRef.current) {
      savedRef.current = cur;
      // Persist this coworker's own posture; fail-open (non-admins simply can't save).
      saveCoworkerGoldenTrianglePosture(agentId, prefRef.current).catch(() => {});
    }
  }

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: "relative" }} onMouseDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (open) close();
          else setOpen(true);
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={`Priority for this coworker: ${activeLabel}. Click to balance cost, quality and time — it tunes how this coworker works.`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 9,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--dpf-muted)",
          background: "transparent",
          border: "1px solid var(--dpf-border)",
          borderRadius: 999,
          padding: "2px 7px 2px 4px",
          cursor: "pointer",
          lineHeight: 1.2,
        }}
      >
        <span style={{ width: 16, height: 14, flex: "0 0 auto", display: "inline-block" }} aria-hidden="true">
          <GoldenTriangleGradient
            qualityWeight={pref.qualityWeight}
            costWeight={pref.costWeight}
            timeWeight={pref.timeWeight}
          />
        </span>
        Priority: {activeLabel}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Set this coworker's priority"
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
            authorityScopeKind="wsid"
          />
          <div style={{ display: "flex", justifyContent: "flex-end", padding: "0 12px 12px" }}>
            <button
              type="button"
              onClick={close}
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: "var(--dpf-text)",
                background: "var(--dpf-surface-2)",
                border: "1px solid var(--dpf-border)",
                borderRadius: 6,
                padding: "4px 12px",
                cursor: "pointer",
              }}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
