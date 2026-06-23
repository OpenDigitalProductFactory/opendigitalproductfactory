"use client";
// EP-GOLDEN-TRIANGLE Slice 2/4 — a small posture area for the AI coworker header.
// A balance-coloured chip (green centred → yellow → red as axes get starved) opens
// the compact control. It LOADS the saved platform (WWMD) default so the chip shows
// what actually governs AI work, and SAVES edits back via the same server action as
// the /platform/ai/priority page — so the two surfaces stay in sync. Saving is
// view_platform-gated server-side; a non-admin simply sees "Couldn't save".
import { useEffect, useState } from "react";

import type { GoldenTrianglePreference } from "@/lib/golden-triangle";

import { getGoldenTrianglePlatformDefault, saveGoldenTrianglePlatformDefault } from "@/lib/actions/golden-triangle";

import { GoldenTriangleControl } from "./GoldenTriangleControl";
import { PRESET_META, balanceState, preferenceFromPreset } from "./posture-display";

export function CoworkerPriorityControl() {
  const [open, setOpen] = useState(false);
  const [pref, setPref] = useState<GoldenTrianglePreference>(preferenceFromPreset("balanced"));
  const [saved, setSaved] = useState<"idle" | "saved" | "error">("idle");
  const [pending, setPending] = useState(false);

  // Reflect the active platform default (fail-open: stay on Balanced if it can't load).
  useEffect(() => {
    let alive = true;
    getGoldenTrianglePlatformDefault()
      .then((p) => {
        if (alive && p) setPref(p);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const balance = balanceState(pref.qualityWeight, pref.costWeight, pref.timeWeight);
  const activeLabel = pref.preset === "custom" ? "Custom" : PRESET_META[pref.preset].label;
  const color = `var(${balance.token})`;

  function onChange(next: GoldenTrianglePreference) {
    setPref(next);
    setSaved("idle");
  }

  async function save() {
    setPending(true);
    setSaved("idle");
    try {
      const res = await saveGoldenTrianglePlatformDefault(pref);
      setSaved(res.ok ? "saved" : "error");
    } catch {
      setSaved("error");
    } finally {
      setPending(false);
    }
  }

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
        title={`Priority for AI work: ${activeLabel} — ${balance.label}. Click to balance cost, quality and time.`}
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
            onChange={onChange}
            compact
            taskClass="conversation"
            authorityScopeKind="wwmd"
          />
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px 12px" }}>
            <button
              type="button"
              onClick={save}
              disabled={pending}
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: "var(--dpf-text)",
                background: "var(--dpf-surface-2)",
                border: "1px solid var(--dpf-border)",
                borderRadius: 6,
                padding: "4px 10px",
                cursor: pending ? "default" : "pointer",
                opacity: pending ? 0.5 : 1,
              }}
            >
              {pending ? "Saving…" : "Save as default"}
            </button>
            {saved === "saved" && <span style={{ fontSize: 11, color: "var(--dpf-success)" }}>Saved</span>}
            {saved === "error" && <span style={{ fontSize: 11, color: "var(--dpf-error)" }}>Couldn’t save</span>}
          </div>
        </div>
      )}
    </div>
  );
}
