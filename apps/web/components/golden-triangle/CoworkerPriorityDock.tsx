"use client";
// EP-GOLDEN-TRIANGLE — the per-coworker priority docked at the composer. Unlike
// the old header chip (a popover that clipped off the panel edge), this lives
// IN-FLOW just above the message input, so the triangle stays in view where you
// type and nothing overflows the window. Collapsible and COLLAPSED BY DEFAULT —
// the resting state is just the colour-graded glyph + preset chip in the header;
// it expands to the full triangle only when the operator opens it, and returns to
// collapsed on the next load/refresh (the everyday state is the compact chip, not
// the open control). Loads and saves THIS coworker's own posture (debounced), so
// each coworker remembers its priority and that posture tunes its runs.
//
// BI-87C9C91C: the per-coworker PROACTIVITY control has been removed from this
// dock. Proactivity belongs to the outcome-specific Workroom, not to whoever is
// staffed to it. Priority (the Golden Triangle) is a different axis and stays —
// it tunes how this coworker's own runs trade cost against quality against time.
//
// BI-20716EA4: posture saves now go through the shared
// `useSaveState` primitive instead of `.catch(() => {})`. A failed save snaps
// the control back to the last confirmed value and shows Retry/Revert next to
// the chip; `resetKey={agentId}` keeps the debounce-flush-on-switch and
// clobber-guard behaviour the hand-rolled refs used to provide, without a
// dock reused across coworkers leaking one agent's failed/pending status onto
// the next.
import { useEffect, useState } from "react";

import type { GoldenTrianglePreference } from "@/lib/golden-triangle";

import { getCoworkerGoldenTrianglePosture, saveCoworkerGoldenTrianglePosture } from "@/lib/actions/golden-triangle";
import { useSaveState } from "@/lib/shared/use-save-state";

import { SaveStateIndicator } from "@/components/ui/SaveStateIndicator";

import { GoldenTriangleControl } from "./GoldenTriangleControl";
import { GoldenTriangleGradient } from "./GoldenTriangleGradient";
import { postureLabel, preferenceFromPreset } from "./posture-display";

export function CoworkerPriorityDock({ agentId }: { agentId: string }) {
  // The server-confirmed load, fed into useSaveState's `value`. A later load
  // response only reconciles into the control when nothing is pending/failed,
  // so an in-flight edit is never clobbered (replaces the old editedRef guard).
  const [loadedPref, setLoadedPref] = useState<GoldenTrianglePreference>(preferenceFromPreset("balanced"));
  // Collapsed by default: the resting state is the compact colour-graded chip in
  // the header, not the open triangle. Re-initializes collapsed on every load so a
  // refresh never leaves the control hanging open (founder report 2026-06-26).
  const [collapsed, setCollapsed] = useState(true);

  const postureSave = useSaveState<GoldenTrianglePreference>({
    value: loadedPref,
    onSave: (next) => saveCoworkerGoldenTrianglePosture(agentId, next),
    // Debounced per-coworker save (drag emits many changes; persist the settled
    // one) — same 800ms window the hand-rolled timer used.
    debounceMs: 800,
    resetKey: agentId,
    failureMessage: "Couldn't save this coworker's priority. Try again.",
  });

  useEffect(() => {
    let alive = true;
    getCoworkerGoldenTrianglePosture(agentId)
      .then((p) => {
        if (alive && p) setLoadedPref(p);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [agentId]);

  const pref = postureSave.value;

  // Same meaningful label as the expanded control's badge — a dragged posture
  // reads e.g. "Lower Cost" (the corner it sits on), never a bare "Custom".
  const activeLabel = postureLabel(pref);

  return (
    <div style={{ borderTop: "1px solid var(--dpf-border)", background: "color-mix(in srgb, var(--dpf-surface-2) 70%, transparent)" }}>
      <div style={{ display: "flex", alignItems: "stretch", width: "100%", minWidth: 0 }}>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          title="Priority for this coworker — cost, quality and time. Tunes how this coworker works."
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            minWidth: 0,
            flex: "1 1 auto",
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
          <span style={{ fontSize: 11, color: "var(--dpf-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {activeLabel}
          </span>
          <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--dpf-muted)" }} aria-hidden="true">
            {collapsed ? "▸" : "▾"}
          </span>
        </button>
      </div>
      {postureSave.status !== "idle" && (
        <div style={{ padding: "0 12px", display: "flex", flexWrap: "wrap", gap: 10 }}>
          <SaveStateIndicator
            compact
            status={postureSave.status}
            error={postureSave.error}
            onRetry={postureSave.retry}
            onRevert={postureSave.revert}
            savedLabel="Priority saved"
            pendingLabel="Saving priority…"
          />
        </div>
      )}
      {!collapsed && (
        <div style={{ padding: "0 12px 10px" }}>
          <GoldenTriangleControl
            value={pref}
            onChange={postureSave.change}
            compact
            taskClass="conversation"
            authorityScopeKind="wsid"
          />
        </div>
      )}
    </div>
  );
}
