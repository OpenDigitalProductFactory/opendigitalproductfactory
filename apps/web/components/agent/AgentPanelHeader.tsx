"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentInfo } from "@/lib/agent-coworker-types";
import type { UserContext } from "@/lib/permissions";
import { AgentSkillsDropdown } from "./AgentSkillsDropdown";
import { CoworkerPriorityControl } from "@/components/golden-triangle/CoworkerPriorityControl";

function formatSensitivityLabel(value: AgentInfo["sensitivity"]): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

type Props = {
  agent: AgentInfo;
  userContext: UserContext;
  onSend: (content: string) => void;
  /**
   * Governed Hermes learning Slice 1 callback. When set, the skills dropdown
   * passes the selected skill's metadata up so the parent panel can show
   * the active-skill chip while the request is in flight.
   */
  onSendSkill?: (skill: { skillId: string; label: string; prompt: string }) => void;
  onOpenClearConfirm: () => void;
  onCancelClearConfirm: () => void;
  onConfirmClear: () => void;
  clearDisabled: boolean;
  clearConfirmOpen: boolean;
  elevatedAssistEnabled: boolean;
  onToggleElevatedAssist: () => void;
  externalAccessEnabled: boolean;
  onToggleExternalAccess: () => void;
  onClose: () => void;
  onDragStart: (e: React.MouseEvent) => void;
  onViewProfile?: () => void;
  providerInfo?: { providerId: string; modelId: string } | null;
  devMode?: boolean;
  canUseDev?: boolean;
  onToggleDev?: () => void;
  coworkerMode?: "advise" | "act";
  onToggleCoworkerMode?: () => void;
  useUnified?: boolean;
  marketingSkillRules?: Record<string, { visible?: boolean; label?: string; reframe?: string }> | null;
  isDocked?: boolean;
};

/** A labelled row with a real switch affordance, used inside the posture menu. */
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

/** A single action row inside the overflow menu. */
function MenuActionRow({
  label,
  onClick,
  title,
  disabled = false,
  tone = "default",
  trailing,
}: {
  label: string;
  onClick: () => void;
  title?: string;
  disabled?: boolean;
  tone?: "default" | "danger";
  trailing?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onClick();
      }}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        width: "100%",
        textAlign: "left",
        background: "none",
        border: "none",
        padding: "8px 12px",
        fontSize: 12,
        lineHeight: 1.3,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        color: tone === "danger" ? "var(--dpf-error)" : "var(--dpf-text)",
      }}
    >
      <span>{label}</span>
      {trailing && <span style={{ fontSize: 10, color: "var(--dpf-muted)" }}>{trailing}</span>}
    </button>
  );
}

export function AgentPanelHeader({
  agent,
  userContext,
  onSend,
  onSendSkill,
  onOpenClearConfirm,
  onCancelClearConfirm,
  onConfirmClear,
  clearDisabled,
  clearConfirmOpen,
  elevatedAssistEnabled,
  onToggleElevatedAssist,
  externalAccessEnabled,
  onToggleExternalAccess,
  onClose,
  onDragStart,
  providerInfo,
  devMode,
  canUseDev,
  onToggleDev,
  coworkerMode,
  onToggleCoworkerMode,
  onViewProfile,
  useUnified,
  marketingSkillRules,
  isDocked = false,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<null | "posture" | "more">(null);
  const showMode = Boolean(useUnified && onToggleCoworkerMode);
  const isAct = coworkerMode === "act";

  // Close any open menu on a click outside the header.
  useEffect(() => {
    if (!menu) return;
    function onDocMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setMenu(null);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [menu]);

  // Plain-language summary of the active posture for the resting chip.
  const summaryParts: string[] = [];
  if (showMode) summaryParts.push(isAct ? "Act" : "Advise");
  if (elevatedAssistEnabled) summaryParts.push("edits on");
  if (externalAccessEnabled) summaryParts.push("web on");
  const summaryLabel = summaryParts.length > 0 ? summaryParts.join(" · ") : "Controls";
  const postureActive = elevatedAssistEnabled || externalAccessEnabled || (showMode && isAct);

  const popoverShell: React.CSSProperties = {
    position: "absolute",
    top: "calc(100% + 8px)",
    right: 0,
    width: 248,
    maxWidth: "calc(100vw - 32px)",
    background: "var(--dpf-surface-1)",
    border: "1px solid var(--dpf-border)",
    borderRadius: 12,
    boxShadow: "0 10px 28px rgba(0,0,0,0.35)",
    zIndex: 5,
    padding: "6px 0",
  };

  return (
    <div
      ref={rootRef}
      onMouseDown={(e) => {
        if (isDocked) return;
        onDragStart(e);
      }}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        padding: "10px 14px",
        background: "color-mix(in srgb, var(--dpf-surface-2) 80%, transparent)",
        borderBottom: "1px solid var(--dpf-border)",
        borderRadius: "12px 12px 0 0",
        cursor: isDocked ? "default" : "grab",
        userSelect: "none",
      }}
    >
      {/* Identity column */}
      <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--dpf-success)]" style={{ flex: "0 0 auto" }} />
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--dpf-text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {agent.agentName}
          </span>
          <AgentSkillsDropdown
            skills={agent.skills}
            userSkills={[]}
            userContext={userContext}
            marketingSkillRules={marketingSkillRules}
            onSend={onSend}
            {...(onSendSkill ? { onSendSkill } : {})}
            onCreateSkill={() => {}}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 12, minWidth: 0 }}>
          <span
            title={`Data sensitivity: ${formatSensitivityLabel(agent.sensitivity)}`}
            style={{
              fontSize: 9,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "var(--dpf-muted)",
              border: "1px solid var(--dpf-border)",
              borderRadius: 999,
              padding: "0 5px",
              lineHeight: 1.6,
              flex: "0 0 auto",
            }}
          >
            {formatSensitivityLabel(agent.sensitivity)}
          </span>
          <span
            style={{
              fontSize: 10,
              color: "var(--dpf-muted)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {agent.agentDescription}
          </span>
        </div>
      </div>

      {/* Right control cluster */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, position: "relative", flex: "0 0 auto" }}>
        {/* Posture control */}
        <div style={{ position: "relative" }} onMouseDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMenu((m) => (m === "posture" ? null : "posture"));
            }}
            aria-expanded={menu === "posture"}
            aria-haspopup="dialog"
            title="Conversation controls — mode, page editing, web access, and priority for this coworker"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 10,
              color: postureActive ? "var(--dpf-text)" : "var(--dpf-muted)",
              background: postureActive ? "color-mix(in srgb, var(--dpf-accent) 12%, transparent)" : "transparent",
              border: `1px solid ${postureActive ? "color-mix(in srgb, var(--dpf-accent) 45%, transparent)" : "var(--dpf-border)"}`,
              borderRadius: 999,
              padding: "3px 8px",
              cursor: "pointer",
              lineHeight: 1.2,
              maxWidth: 180,
            }}
          >
            {postureActive && (
              <span
                aria-hidden="true"
                style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--dpf-accent)", flex: "0 0 auto" }}
              />
            )}
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summaryLabel}</span>
            <span aria-hidden="true" style={{ fontSize: 8, opacity: 0.8 }}>▾</span>
          </button>
          {menu === "posture" && (
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
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "8px 12px 4px",
                  borderTop: "1px solid color-mix(in srgb, var(--dpf-border) 60%, transparent)",
                  marginTop: 4,
                }}
              >
                <span style={{ fontSize: 12, color: "var(--dpf-text)" }}>Priority</span>
                <CoworkerPriorityControl />
              </div>
            </div>
          )}
        </div>

        {/* Overflow menu */}
        <div style={{ position: "relative" }} onMouseDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMenu((m) => (m === "more" ? null : "more"));
            }}
            aria-expanded={menu === "more"}
            aria-haspopup="menu"
            aria-label="More options"
            title="More — profile, diagnostics, erase conversation"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 26,
              height: 24,
              background: "none",
              border: "1px solid var(--dpf-border)",
              borderRadius: 6,
              color: "var(--dpf-muted)",
              cursor: "pointer",
              fontSize: 15,
              lineHeight: 1,
            }}
          >
            ⋯
          </button>
          {menu === "more" && (
            <div role="menu" aria-label="More options" style={popoverShell}>
              {onViewProfile && (
                <MenuActionRow
                  label="View profile, skills & tools"
                  title="View coworker profile, skills, and tools"
                  onClick={() => {
                    setMenu(null);
                    onViewProfile();
                  }}
                />
              )}
              {canUseDev && onToggleDev && (
                <MenuActionRow
                  label="Diagnostics"
                  trailing={devMode ? "On" : undefined}
                  title={
                    devMode
                      ? "Exit diagnostics mode"
                      : "Diagnostics: inspect page context and explain likely fixes. Use Build Studio for code-changing work"
                  }
                  onClick={() => {
                    setMenu(null);
                    onToggleDev();
                  }}
                />
              )}
              <MenuActionRow
                label="Erase conversation"
                tone="danger"
                disabled={clearDisabled}
                title="Erase current conversation"
                onClick={() => {
                  setMenu(null);
                  onOpenClearConfirm();
                }}
              />
              {providerInfo && (
                <div
                  style={{
                    fontSize: 9,
                    color: "var(--dpf-muted)",
                    fontFamily: "monospace",
                    padding: "6px 12px 2px",
                    borderTop: "1px solid color-mix(in srgb, var(--dpf-border) 60%, transparent)",
                    marginTop: 4,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  model · {providerInfo.providerId}:{providerInfo.modelId}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Close */}
        <button
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          title="Close"
          aria-label="Close coworker panel"
          style={{
            background: "none",
            border: "none",
            color: "var(--dpf-muted)",
            cursor: "pointer",
            fontSize: 16,
            padding: "2px 6px",
            borderRadius: 4,
            lineHeight: 1,
          }}
        >
          x
        </button>

        {/* Erase confirmation (parent-controlled) */}
        {clearConfirmOpen && (
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 8px)",
              right: 30,
              width: 220,
              padding: 10,
              background: "color-mix(in srgb, var(--dpf-surface-1) 96%, transparent)",
              border: "1px solid var(--dpf-border)",
              borderRadius: 10,
              boxShadow: "0 10px 28px rgba(0,0,0,0.35)",
              display: "flex",
              flexDirection: "column",
              gap: 8,
              zIndex: 6,
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <span style={{ fontSize: 12, color: "var(--dpf-text)", lineHeight: 1.4 }}>
              Erase this page conversation?
            </span>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onCancelClearConfirm();
                }}
                style={{
                  background: "none",
                  border: "1px solid var(--dpf-border)",
                  borderRadius: 6,
                  color: "var(--dpf-muted)",
                  cursor: "pointer",
                  fontSize: 11,
                  lineHeight: 1,
                  padding: "5px 8px",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onConfirmClear();
                }}
                style={{
                  background: "color-mix(in srgb, var(--dpf-error) 16%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--dpf-error) 50%, transparent)",
                  borderRadius: 6,
                  color: "var(--dpf-error)",
                  cursor: "pointer",
                  fontSize: 11,
                  lineHeight: 1,
                  padding: "5px 8px",
                }}
              >
                Erase now
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
