"use client";

import type { AgentInfo } from "@/lib/agent-coworker-types";
import type { UserContext } from "@/lib/permissions";
import { AgentSkillsDropdown } from "./AgentSkillsDropdown";

function formatSensitivityLabel(value: AgentInfo["sensitivity"]): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

type Props = {
  agent: AgentInfo;
  userContext: UserContext;
  onSend: (content: string) => void;
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
  sensitivityLevel?: string;
  useUnified?: boolean;
  marketingSkillRules?: Record<string, { visible?: boolean; label?: string; reframe?: string }> | null;
  isDocked?: boolean;
};

export function AgentPanelHeader({
  agent,
  userContext,
  onSend,
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
  sensitivityLevel,
  useUnified,
  marketingSkillRules,
  isDocked = false,
}: Props) {
  return (
    <div
      onMouseDown={(e) => {
        if (isDocked) return;
        onDragStart(e);
      }}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 14px",
        background: "color-mix(in srgb, var(--dpf-surface-2) 80%, transparent)",
        borderBottom: "1px solid var(--dpf-border)",
        borderRadius: "12px 12px 0 0",
        cursor: isDocked ? "default" : "grab",
        userSelect: "none",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--dpf-success)]" />
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--dpf-text)" }}>
            {agent.agentName}
          </span>
          <AgentSkillsDropdown
            skills={agent.skills}
            userSkills={[]}
            userContext={userContext}
            marketingSkillRules={marketingSkillRules}
            onSend={onSend}
            onCreateSkill={() => {}}
          />
          {onViewProfile && (
            <button
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onViewProfile();
              }}
              title="View coworker profile, skills, and tools"
              style={{
                background: "none",
                border: "1px solid var(--dpf-border)",
                color: "var(--dpf-muted)",
                fontSize: 9,
                cursor: "pointer",
                padding: "1px 5px",
                borderRadius: 3,
                lineHeight: "14px",
              }}
            >
              Profile
            </button>
          )}
          {providerInfo && (
            <span style={{ fontSize: 9, color: "var(--dpf-muted)", fontFamily: "monospace" }}>
              {providerInfo.providerId}:{providerInfo.modelId}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginLeft: 12 }}>
          <span
            style={{
              fontSize: 9,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--dpf-text)",
              border: "1px solid var(--dpf-border)",
              borderRadius: 999,
              padding: "2px 6px",
            }}
          >
            {formatSensitivityLabel(agent.sensitivity)}
          </span>
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onToggleElevatedAssist();
            }}
            title={
              elevatedAssistEnabled
                ? "Hands On: this page's coworker can update approved form fields"
                : "Hands Off: this page's coworker can suggest changes without updating form fields"
            }
            style={{
              fontSize: 9,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: elevatedAssistEnabled ? "#241700" : "var(--dpf-muted)",
              background: elevatedAssistEnabled ? "var(--dpf-warning)" : "transparent",
              border: `1px solid ${elevatedAssistEnabled ? "var(--dpf-warning)" : "var(--dpf-border)"}`,
              borderRadius: 999,
              padding: "2px 6px",
              fontWeight: elevatedAssistEnabled ? 700 : 500,
              cursor: "pointer",
              lineHeight: 1.2,
            }}
          >
            {elevatedAssistEnabled ? "Hands On" : "Hands Off"}
          </button>
          {useUnified && onToggleCoworkerMode ? (
            <button
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onToggleCoworkerMode();
              }}
              title={
                coworkerMode === "act"
                  ? "Act: AI executes within your authority"
                  : "Advise: AI recommends but doesn't act"
              }
              style={{
                fontSize: 9,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: coworkerMode === "act" ? "var(--dpf-success)" : "var(--dpf-muted)",
                background: coworkerMode === "act" ? "color-mix(in srgb, var(--dpf-success) 16%, transparent)" : "transparent",
                border: `1px solid ${coworkerMode === "act" ? "color-mix(in srgb, var(--dpf-success) 55%, transparent)" : "var(--dpf-border)"}`,
                borderRadius: 999,
                padding: "2px 6px",
                fontWeight: coworkerMode === "act" ? 700 : 500,
                cursor: "pointer",
                lineHeight: 1.2,
              }}
            >
              {coworkerMode === "act" ? "Act" : "Advise"}
            </button>
          ) : (
            <button
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onToggleExternalAccess();
              }}
              title={
                externalAccessEnabled
                  ? "External On: this page's coworker can use approved public web search and fetch tools during this session"
                  : "External Off: this page's coworker cannot access approved public web search and fetch tools during this session"
              }
              style={{
                fontSize: 9,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: externalAccessEnabled ? "var(--dpf-success)" : "var(--dpf-muted)",
                background: externalAccessEnabled ? "color-mix(in srgb, var(--dpf-success) 16%, transparent)" : "transparent",
                border: `1px solid ${externalAccessEnabled ? "color-mix(in srgb, var(--dpf-success) 55%, transparent)" : "var(--dpf-border)"}`,
                borderRadius: 999,
                padding: "2px 6px",
                fontWeight: externalAccessEnabled ? 700 : 500,
                cursor: "pointer",
                lineHeight: 1.2,
              }}
            >
              {externalAccessEnabled ? "External Access On" : "External Access Off"}
            </button>
          )}
          {canUseDev && onToggleDev && (
            <button
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onToggleDev();
              }}
              title={devMode ? "Exit dev mode — back to normal" : "Dev mode — search code, diagnose issues, propose fixes for this page"}
              style={{
                fontSize: 9,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: devMode ? "var(--dpf-text)" : "var(--dpf-muted)",
                background: devMode ? "color-mix(in srgb, var(--dpf-accent) 30%, transparent)" : "transparent",
                border: `1px solid ${devMode ? "var(--dpf-accent)" : "var(--dpf-border)"}`,
                borderRadius: 999,
                padding: "2px 6px",
                fontWeight: devMode ? 700 : 500,
                cursor: "pointer",
                lineHeight: 1.2,
              }}
            >
              Dev
            </button>
          )}
          {sensitivityLevel && (
            <span
              title={`Page sensitivity: ${sensitivityLevel}`}
              style={{
                fontSize: 8,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "var(--dpf-muted)",
                border: "1px dashed var(--dpf-border)",
                borderRadius: 999,
                padding: "1px 5px",
                lineHeight: 1.3,
              }}
            >
              {sensitivityLevel}
            </span>
          )}
        </div>
        <span style={{ fontSize: 10, color: "var(--dpf-muted)", marginLeft: 12 }}>
          {agent.agentDescription}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, position: "relative" }}>
        <button
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onOpenClearConfirm();
          }}
          disabled={clearDisabled}
          title="Erase current conversation"
          style={{
            background: "none",
            border: "1px solid var(--dpf-border)",
            color: "var(--dpf-muted)",
            cursor: clearDisabled ? "not-allowed" : "pointer",
            fontSize: 11,
            padding: "4px 8px",
            borderRadius: 6,
            lineHeight: 1,
            opacity: clearDisabled ? 0.5 : 1,
          }}
        >
          Erase
        </button>
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
              zIndex: 2,
            }}
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
        <button
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          title="Close"
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
      </div>
    </div>
  );
}
