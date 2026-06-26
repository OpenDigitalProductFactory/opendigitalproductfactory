"use client";
// EP-COWORKER-RT / WS4 (coworker-management-consolidation design §4 WS4,
// docs/superpowers/specs/2026-06-26-coworker-management-consolidation-design.md):
// the per-coworker Golden-Triangle priority section ON THE RECORD. Unlike the
// composer dock (CoworkerPriorityDock, per-conversation last-mile), this is the
// durable coworker-level override and ALWAYS shows the inheritance chain:
//   "Inherited from Platform default"  (no own override)
//   "Overridden for this coworker"     (own override set)
// It writes saveCoworkerGoldenTrianglePosture (and resetCoworkerGoldenTrianglePosture
// to fall back to inherited). The cascade it tunes — agent → org → platform → Balanced —
// is the same one live dispatch consults via resolveDispatchPosture (already wired
// at the prepareRoute seam), so a centrally-set or coworker-set priority actually
// governs routing.
//
// Read-only when the viewer lacks manage_platform: the control renders the
// inherited/overridden posture and the chips, but the presets/triangle and the
// save/reset actions are hidden (same canWrite contract as AgentModelRoutingCard /
// CapabilitiesEditor).
import { useRef, useState } from "react";

import type { GoldenTrianglePreference } from "@/lib/golden-triangle";

import {
  resetCoworkerGoldenTrianglePosture,
  saveCoworkerGoldenTrianglePosture,
  type CoworkerPostureInheritance,
} from "@/lib/actions/golden-triangle";

import { GoldenTriangleControl } from "./GoldenTriangleControl";
import { decodePostureForDisplay, postureLabel, preferenceFromPreset } from "./posture-display";

type SourceLabel = { text: string; tone: "accent" | "muted" };

/** Map the resolved scope to the plain-language inheritance line the founder asked for. */
function inheritanceLine(source: CoworkerPostureInheritance["source"], hasOwnOverride: boolean): SourceLabel {
  if (hasOwnOverride) return { text: "Overridden for this coworker", tone: "accent" };
  switch (source) {
    case "organization":
      return { text: "Inherited from Organization default", tone: "muted" };
    case "platform":
      return { text: "Inherited from Platform default", tone: "muted" };
    case "agent":
      // source agent but !hasOwnOverride should not happen; treat as overridden.
      return { text: "Overridden for this coworker", tone: "accent" };
    default:
      return { text: "Inherited from Platform default (Balanced)", tone: "muted" };
  }
}

export interface CoworkerPriorityControlProps {
  agentId: string;
  /** The effective posture + provenance, resolved server-side (getCoworkerPostureInheritance). */
  inheritance: CoworkerPostureInheritance;
  /** manage_platform — gates the editable controls + save/reset, same as the rest of the record. */
  canWrite: boolean;
}

export function CoworkerPriorityControl({ agentId, inheritance, canWrite }: CoworkerPriorityControlProps) {
  const initialPref = inheritance.effective ?? preferenceFromPreset("balanced");
  const [pref, setPref] = useState<GoldenTrianglePreference>(initialPref);
  const [overridden, setOverridden] = useState(inheritance.hasOwnOverride);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const savedRef = useRef<string>(JSON.stringify(initialPref));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const line = inheritanceLine(inheritance.source, overridden);

  function onChange(next: GoldenTrianglePreference) {
    setPref(next);
    setStatus("idle");
    if (timerRef.current) clearTimeout(timerRef.current);
    // Debounced per-coworker save (drag emits many changes; persist the settled one).
    timerRef.current = setTimeout(() => {
      const cur = JSON.stringify(next);
      if (cur === savedRef.current) return;
      setStatus("saving");
      saveCoworkerGoldenTrianglePosture(agentId, next)
        .then((res) => {
          if (res.ok) {
            savedRef.current = cur;
            setOverridden(true);
            setStatus("saved");
          } else {
            setStatus("error");
          }
        })
        .catch(() => setStatus("error"));
    }, 700);
  }

  function onReset() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setStatus("saving");
    resetCoworkerGoldenTrianglePosture(agentId)
      .then((res) => {
        if (res.ok) {
          setOverridden(false);
          setStatus("saved");
          // Optimistically reflect the resolved fallback if we know it; otherwise
          // leave the current display until the route revalidation re-renders.
          savedRef.current = JSON.stringify(pref);
        } else {
          setStatus("error");
        }
      })
      .catch(() => setStatus("error"));
  }

  const lineColor = line.tone === "accent" ? "var(--dpf-accent)" : "var(--dpf-muted)";

  return (
    <div>
      {/* Inheritance chain — the founder's "inherited vs overridden" requirement. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <span
          style={{
            fontSize: 10,
            padding: "2px 8px",
            borderRadius: 4,
            border: `1px solid ${lineColor}`,
            color: lineColor,
            whiteSpace: "nowrap",
          }}
        >
          {line.text}
        </span>
        <span style={{ fontSize: 11, color: "var(--dpf-muted)" }}>
          Active priority: <strong style={{ color: "var(--dpf-text)" }}>{postureLabel(pref)}</strong>
        </span>
        {canWrite && overridden && (
          <button
            type="button"
            onClick={onReset}
            disabled={status === "saving"}
            style={{
              marginLeft: "auto",
              fontSize: 11,
              padding: "3px 10px",
              borderRadius: 4,
              border: "1px solid var(--dpf-border)",
              background: "var(--dpf-surface-1)",
              color: "var(--dpf-text)",
              cursor: status === "saving" ? "default" : "pointer",
            }}
          >
            Reset to inherited
          </button>
        )}
      </div>

      {canWrite ? (
        <>
          <GoldenTriangleControl
            value={pref}
            onChange={onChange}
            taskClass="conversation"
            authorityScopeKind="wsid"
          />
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, minHeight: 16 }}>
            {status === "saving" && <span style={{ fontSize: 11, color: "var(--dpf-muted)" }}>Saving…</span>}
            {status === "saved" && <span style={{ fontSize: 11, color: "var(--dpf-success)" }}>Saved</span>}
            {status === "error" && <span style={{ fontSize: 11, color: "var(--dpf-error)" }}>Could not save</span>}
            <span style={{ fontSize: 10, color: "var(--dpf-muted)" }}>
              Changes take effect on this coworker&apos;s next routing decision.
            </span>
          </div>
        </>
      ) : (
        <ReadOnlyPosture pref={pref} />
      )}
    </div>
  );
}

/** Read-only view for viewers without manage_platform: the configured chips, no controls. */
function ReadOnlyPosture({ pref }: { pref: GoldenTrianglePreference }) {
  const { chips } = decodePostureForDisplay(pref, "conversation", "wsid");
  return (
    <div
      style={{
        borderRadius: 8,
        border: "1px solid var(--dpf-border)",
        background: "var(--dpf-surface-1)",
        padding: 14,
      }}
    >
      <div style={{ fontSize: 11, color: "var(--dpf-muted)", marginBottom: 8 }}>
        This is what the current priority configures (read-only — requires platform-admin to change):
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {chips.map((chip, i) => (
          <span
            key={`${chip.label}-${i}`}
            style={{
              fontSize: 11,
              padding: "2px 8px",
              borderRadius: 4,
              background: "var(--dpf-surface-2)",
              color: "var(--dpf-text-secondary)",
            }}
          >
            {chip.label}
          </span>
        ))}
      </div>
    </div>
  );
}
