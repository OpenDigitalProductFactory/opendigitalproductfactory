"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  elevatedAssistEnabled: boolean;
  onToggleElevatedAssist: () => void;
  externalAccessEnabled: boolean;
  onToggleExternalAccess: () => void;
  /**
   * When false, the Web access switch is hidden. Agents without the
   * `web_search` grant cannot use public web tools even if the session
   * flag is on — showing the toggle is a no-op (BI-CD9DC3BC).
   */
  webAccessAvailable?: boolean;
  coworkerMode?: "advise" | "act";
  onToggleCoworkerMode?: () => void;
  useUnified?: boolean;
  /** Which way the popover opens. The composer (bottom of the panel) opens up. */
  openDirection?: "up" | "down";
  /** Which edge the popover aligns to. */
  align?: "left" | "right";
  disabled?: boolean;
};

/** A labelled row with a real switch affordance. */
function ToggleSwitchRow({
  checked,
  onToggle,
  label,
  description,
  title,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  description: string;
  title: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        width: "100%",
        textAlign: "left",
        background: "none",
        border: "none",
        padding: "8px 12px",
        cursor: "pointer",
      }}
    >
      <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
        <span style={{ fontSize: 12, color: "var(--dpf-text)" }}>{label}</span>
        <span style={{ fontSize: 10, color: "var(--dpf-muted)", lineHeight: 1.3 }}>{description}</span>
      </span>
      <span
        aria-hidden="true"
        style={{
          position: "relative",
          width: 34,
          height: 18,
          borderRadius: 999,
          flex: "0 0 auto",
          background: checked
            ? "var(--dpf-success)"
            : "color-mix(in srgb, var(--dpf-text) 22%, transparent)",
          transition: "background 0.15s ease",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            left: checked ? 18 : 2,
            width: 14,
            height: 14,
            borderRadius: "50%",
            background: "var(--dpf-text)",
            transition: "left 0.15s ease",
          }}
        />
      </span>
    </button>
  );
}

/**
 * The coworker "posture" control — a compact summary chip that expands into the
 * real switches that govern how much the coworker can do this conversation:
 * mode (advise/act), page editing, and web access.
 *
 * Lives in the composer lip (input-anchored), matching the permission controls
 * leading assistant UIs place next to the prompt box. Work *priority* (the
 * Golden Triangle) is a separate concern and lives in its own dock at the
 * composer (CoworkerPriorityDock) — it is intentionally NOT in this menu.
 */
export function CoworkerPostureControl({
  elevatedAssistEnabled,
  onToggleElevatedAssist,
  externalAccessEnabled,
  onToggleExternalAccess,
  webAccessAvailable = true,
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
  const showWebAccess = webAccessAvailable;

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
  if (elevatedAssistEnabled) summaryParts.push("edits on");
  if (showWebAccess && externalAccessEnabled) summaryParts.push("web on");
  const summaryLabel = summaryParts.length > 0 ? summaryParts.join(" · ") : "Controls";
  const postureActive =
    elevatedAssistEnabled || (showWebAccess && externalAccessEnabled) || (showMode && isAct);

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
        title="Conversation controls — mode, page editing, and web access for this coworker"
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
          <ToggleSwitchRow
            checked={elevatedAssistEnabled}
            onToggle={onToggleElevatedAssist}
            label="Edit fields on this page"
            description="Let the coworker fill in forms for you"
            title={
              elevatedAssistEnabled
                ? "On: this page's coworker can update approved form fields"
                : "Off: this page's coworker only suggests changes"
            }
          />
          {showWebAccess && (
            <ToggleSwitchRow
              checked={externalAccessEnabled}
              onToggle={onToggleExternalAccess}
              label="Web access"
              description="Allow web search and fetch this session"
              title={
                externalAccessEnabled
                  ? "On: this page's coworker can use approved public web search and fetch tools"
                  : "Off: this page's coworker cannot reach public web tools"
              }
            />
          )}
        </div>
      )}
    </div>
  );
}
