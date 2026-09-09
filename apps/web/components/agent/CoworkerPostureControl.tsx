"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  coworkerMode?: "advise" | "act";
  onToggleCoworkerMode?: () => void;
  useUnified?: boolean;
  /** Which way the popover opens. The composer (bottom of the panel) opens up. */
  openDirection?: "up" | "down";
  /** Which edge the popover aligns to. */
  align?: "left" | "right";
  disabled?: boolean;
};

/**
 * The coworker "posture" control — a compact summary chip that expands into the
 * Advise / Act mode switch for this conversation.
 *
 * EP-WORK-POSTURE 8.2 (founder direction 2026-09-08, BI-947780FE): the
 * "Edit fields on this page" and "Web access" switches that used to live here
 * are gone. Whether a coworker may act hands-on in the UI or reach the public
 * web is a consequence of the Workroom it is working in (its shape, its
 * declared activity, the coworker's role and standing grants) — resolved
 * server-side per turn, never a per-conversation preference. Work priority
 * (the Golden Triangle) is likewise a Workroom parameter (BI-7ADEBDC1).
 *
 * Renders nothing when there is no mode to switch, rather than an empty menu.
 */
export function CoworkerPostureControl({
  coworkerMode,
  onToggleCoworkerMode,
  useUnified,
  openDirection = "down",
  align = "left",
  disabled = false,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const showMode = Boolean(useUnified && onToggleCoworkerMode);
  const isAct = coworkerMode === "act";

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  const summaryParts: string[] = [];
  if (showMode) summaryParts.push(isAct ? "Act" : "Advise");
  const summaryLabel = summaryParts.length > 0 ? summaryParts.join(" · ") : "Controls";
  const postureActive = showMode && isAct;

  const popoverShell: React.CSSProperties = {
    position: "absolute",
    ...(openDirection === "up" ? { bottom: "calc(100% + 8px)" } : { top: "calc(100% + 8px)" }),
    ...(align === "right" ? { right: 0 } : { left: 0 }),
    width: 248,
    maxWidth: "calc(100vw - 32px)",
    background: "var(--dpf-surface-1)",
    border: "1px solid var(--dpf-border)",
    borderRadius: 12,
    boxShadow: "0 10px 28px rgba(0,0,0,0.35)",
    zIndex: 30,
    padding: "6px 0",
  };

  if (!showMode) return null;

  return (
    <div ref={rootRef} style={{ position: "relative" }} onMouseDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        // BI-3238AAF0: a stable owner-readable accessible name. Without it the
        // button's accessible name collapses to the visible summary — "Controls"
        // when nothing is active — which reads as cryptic chrome. The visible
        // summary still communicates active posture at a glance.
        aria-label={`Conversation controls${summaryParts.length > 0 ? `: ${summaryLabel}` : ""}`}
        title="Conversation controls — Advise or Act for this coworker. Page editing and web access follow the room, not this menu."
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          fontSize: 11,
          color: postureActive ? "var(--dpf-text)" : "var(--dpf-muted)",
          background: postureActive ? "color-mix(in srgb, var(--dpf-accent) 12%, transparent)" : "transparent",
          border: `1px solid ${postureActive ? "color-mix(in srgb, var(--dpf-accent) 45%, transparent)" : "var(--dpf-border)"}`,
          borderRadius: 999,
          padding: "3px 9px",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
          lineHeight: 1.2,
          maxWidth: 180,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: postureActive ? "var(--dpf-accent)" : "var(--dpf-muted)",
            flex: "0 0 auto",
          }}
        />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summaryLabel}</span>
        <span aria-hidden="true" style={{ fontSize: 8, opacity: 0.8 }}>{openDirection === "up" ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div role="dialog" aria-label="Conversation controls" style={popoverShell}>
          <div
            style={{
              fontSize: 9,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "var(--dpf-muted)",
              padding: "4px 12px 6px",
            }}
          >
            This conversation
          </div>
          {showMode && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "6px 12px",
              }}
            >
              <span style={{ fontSize: 12, color: "var(--dpf-text)" }}>Mode</span>
              <span
                style={{
                  display: "inline-flex",
                  border: "1px solid var(--dpf-border)",
                  borderRadius: 999,
                  overflow: "hidden",
                }}
              >
                {(["advise", "act"] as const).map((m) => {
                  const active = isAct ? m === "act" : m === "advise";
                  return (
                    <button
                      key={m}
                      type="button"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!active) onToggleCoworkerMode?.();
                      }}
                      title={
                        m === "act"
                          ? "Act: the coworker executes within your authority"
                          : "Advise: the coworker recommends but doesn't act"
                      }
                      style={{
                        fontSize: 11,
                        padding: "2px 10px",
                        border: "none",
                        cursor: active ? "default" : "pointer",
                        fontWeight: active ? 600 : 400,
                        color: active ? "var(--dpf-text)" : "var(--dpf-muted)",
                        background: active
                          ? m === "act"
                            ? "color-mix(in srgb, var(--dpf-success) 18%, transparent)"
                            : "var(--dpf-surface-2)"
                          : "transparent",
                      }}
                    >
                      {m === "act" ? "Act" : "Advise"}
                    </button>
                  );
                })}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
