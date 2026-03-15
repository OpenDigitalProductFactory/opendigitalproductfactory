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
  onClear: () => void;
  clearDisabled: boolean;
  elevatedAssistEnabled: boolean;
  onToggleElevatedAssist: () => void;
  onClose: () => void;
  onDragStart: (e: React.MouseEvent) => void;
};

export function AgentPanelHeader({
  agent,
  userContext,
  onSend,
  onClear,
  clearDisabled,
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
          {elevatedAssistEnabled && (
            <span
              style={{
                fontSize: 9,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "#241700",
                background: "#facc15",
                borderRadius: 999,
                padding: "2px 6px",
                fontWeight: 700,
              }}
            >
              Hands On
            </span>
          )}
        </div>
        <span style={{ fontSize: 10, color: "var(--dpf-muted)", marginLeft: 12 }}>
          {agent.agentDescription}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
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
            background: elevatedAssistEnabled ? "rgba(250, 204, 21, 0.18)" : "none",
            border: `1px solid ${elevatedAssistEnabled ? "rgba(250, 204, 21, 0.65)" : "rgba(255, 255, 255, 0.12)"}`,
            color: elevatedAssistEnabled ? "#facc15" : "var(--dpf-muted)",
            cursor: "pointer",
            fontSize: 11,
            padding: "4px 8px",
            borderRadius: 6,
            lineHeight: 1,
          }}
        >
          {elevatedAssistEnabled ? "Hands On" : "Hands Off"}
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onClear();
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
