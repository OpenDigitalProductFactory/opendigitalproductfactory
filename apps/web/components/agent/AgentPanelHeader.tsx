"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentInfo } from "@/lib/agent-coworker-types";
import type { UserContext } from "@/lib/permissions";
import { AgentSkillsDropdown } from "./AgentSkillsDropdown";
import { SHELL_TAP_TARGET_CLASS } from "@/lib/shell/shell-action-contract";
import type { CoworkerPresentationIdentity } from "@/lib/coworker-presentation/coo-name";

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
  onClose: () => void;
  onDragStart: (e: React.MouseEvent) => void;
  onViewProfile?: () => void;
  providerInfo?: { providerId: string; modelId: string } | null;
  devMode?: boolean;
  canUseDev?: boolean;
  onToggleDev?: () => void;
  marketingSkillRules?: Record<string, { visible?: boolean; label?: string; reframe?: string }> | null;
  isDocked?: boolean;
  /**
   * BI-3238AAF0: the business area / route the panel is currently attached to
   * (e.g. "Finance", "Marketing"). Rendered as a context chip so an owner can
   * always tell WHERE the coworker is helping, especially after the panel is
   * carried across a navigation.
   */
  routeContextLabel?: string;
  presentationIdentity?: CoworkerPresentationIdentity;
};

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
  onClose,
  onDragStart,
  providerInfo,
  devMode,
  canUseDev,
  onToggleDev,
  onViewProfile,
  marketingSkillRules,
  isDocked = false,
  routeContextLabel,
  presentationIdentity,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the overflow menu on a click outside the header.
  useEffect(() => {
    if (!menuOpen) return;
    function onDocMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [menuOpen]);

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
            {presentationIdentity?.primaryName ?? agent.agentName}
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
          {presentationIdentity?.roleName && (
            <span style={{ fontSize: 10, color: "var(--dpf-muted)", flex: "0 0 auto" }}>
              {presentationIdentity.roleName}
            </span>
          )}
          {routeContextLabel && (
            <span
              data-testid="panel-route-context"
              title={`Helping on: ${routeContextLabel}`}
              aria-label={`Current context: ${routeContextLabel}`}
              style={{
                fontSize: 9,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "var(--dpf-accent)",
                border: "1px solid color-mix(in srgb, var(--dpf-accent) 45%, transparent)",
                background: "color-mix(in srgb, var(--dpf-accent) 10%, transparent)",
                borderRadius: 999,
                padding: "0 6px",
                lineHeight: 1.6,
                flex: "0 0 auto",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: 140,
              }}
            >
              {routeContextLabel}
            </span>
          )}
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
            className="hidden sm:inline"
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
        {/* Overflow menu */}
        <div style={{ position: "relative" }} onMouseDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((m) => !m);
            }}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label="More options"
            title="More — profile, diagnostics, erase conversation"
            // Common Shell Action-Result Contract (BI-9C0954D0) C5: ≥44px tap target.
            className={SHELL_TAP_TARGET_CLASS}
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
          {menuOpen && (
            <div
              role="menu"
              aria-label="More options"
              style={{
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
              }}
            >
              {onViewProfile && (
                <MenuActionRow
                  label="View profile, skills & tools"
                  title="View coworker profile, skills, and tools"
                  onClick={() => {
                    setMenuOpen(false);
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
                    setMenuOpen(false);
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
                  setMenuOpen(false);
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
          // Common Shell Action-Result Contract (BI-9C0954D0) C5: ≥44px tap target.
          className={SHELL_TAP_TARGET_CLASS}
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
