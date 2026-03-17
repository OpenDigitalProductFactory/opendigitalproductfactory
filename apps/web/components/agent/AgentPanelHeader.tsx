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
  providerInfo?: { providerId: string; modelId: string } | null;
  cooMode?: boolean;
  canUseCoo?: boolean;
  onToggleCoo?: () => void;
  coworkerMode?: "advise" | "act";
  onToggleCoworkerMode?: () => void;
  sensitivityLevel?: string;
  useUnified?: boolean;
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
  cooMode,
  canUseCoo,
  onToggleCoo,
  coworkerMode,
  onToggleCoworkerMode,
  sensitivityLevel,
  useUnified,
}: Props) {
  return (
    <div
      onMouseDown={onDragStart}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 14px",
        background: "rgba(22, 22, 37, 0.8)",
        borderBottom: "1px solid rgba(42, 42, 64, 0.6)",
        borderRadius: "12px 12px 0 0",
        cursor: "grab",
        userSelect: "none",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400" />
          <span style={{ fontSize: 12, fontWeight: 600, color: "#e0e0ff" }}>
            {agent.agentName}
          </span>
          <AgentSkillsDropdown
            skills={agent.skills}
            userContext={userContext}
            onSend={onSend}
          />
          {providerInfo && (
            <span style={{ fontSize: 9, color: "#8888a0", fontFamily: "monospace" }}>
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
              color: "rgba(224, 224, 255, 0.78)",
              border: "1px solid rgba(255, 255, 255, 0.12)",
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
              color: elevatedAssistEnabled ? "#241700" : "rgba(224, 224, 255, 0.78)",
              background: elevatedAssistEnabled ? "#facc15" : "transparent",
              border: `1px solid ${elevatedAssistEnabled ? "#facc15" : "rgba(255, 255, 255, 0.12)"}`,
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
                color: coworkerMode === "act" ? "#a7f3d0" : "rgba(224, 224, 255, 0.78)",
                background: coworkerMode === "act" ? "rgba(16, 185, 129, 0.16)" : "transparent",
                border: `1px solid ${coworkerMode === "act" ? "rgba(16, 185, 129, 0.55)" : "rgba(255, 255, 255, 0.12)"}`,
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
                color: externalAccessEnabled ? "#a7f3d0" : "rgba(224, 224, 255, 0.78)",
                background: externalAccessEnabled ? "rgba(16, 185, 129, 0.16)" : "transparent",
                border: `1px solid ${externalAccessEnabled ? "rgba(16, 185, 129, 0.55)" : "rgba(255, 255, 255, 0.12)"}`,
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
          {canUseCoo && onToggleCoo && (
            <button
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onToggleCoo();
              }}
              title={cooMode ? "Switch back to this page's specialist agent" : "Switch to COO — cross-cutting oversight agent"}
              style={{
                fontSize: 9,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: cooMode ? "#fff" : "rgba(224, 224, 255, 0.78)",
                background: cooMode ? "rgba(124, 140, 248, 0.3)" : "transparent",
                border: `1px solid ${cooMode ? "#7c8cf8" : "rgba(255, 255, 255, 0.12)"}`,
                borderRadius: 999,
                padding: "2px 6px",
                fontWeight: cooMode ? 700 : 500,
                cursor: "pointer",
                lineHeight: 1.2,
              }}
            >
              COO
            </button>
          )}
          {sensitivityLevel && (
            <span
              title={`Page sensitivity: ${sensitivityLevel}`}
              style={{
                fontSize: 8,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "rgba(224, 224, 255, 0.55)",
                border: "1px dashed rgba(255, 255, 255, 0.1)",
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
            border: "1px solid rgba(255, 255, 255, 0.12)",
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
              background: "rgba(26, 26, 46, 0.96)",
              border: "1px solid rgba(42, 42, 64, 0.8)",
              borderRadius: 10,
              boxShadow: "0 10px 28px rgba(0,0,0,0.35)",
              display: "flex",
              flexDirection: "column",
              gap: 8,
              zIndex: 2,
            }}
          >
            <span style={{ fontSize: 12, color: "#e0e0ff", lineHeight: 1.4 }}>
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
                  border: "1px solid rgba(255, 255, 255, 0.12)",
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
                  background: "rgba(239, 68, 68, 0.16)",
                  border: "1px solid rgba(239, 68, 68, 0.5)",
                  borderRadius: 6,
                  color: "#fca5a5",
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
