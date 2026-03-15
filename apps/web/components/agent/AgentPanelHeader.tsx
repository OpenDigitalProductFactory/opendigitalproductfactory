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
  onClose: () => void;
  onDragStart: (e: React.MouseEvent) => void;
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
  onClose,
  onDragStart,
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
