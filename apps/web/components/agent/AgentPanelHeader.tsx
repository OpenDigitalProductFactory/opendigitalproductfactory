"use client";

import type { AgentInfo } from "@/lib/agent-coworker-types";

type Props = {
  agent: AgentInfo;
  onMouseDown: (e: React.MouseEvent) => void; // drag handle
  onClose: () => void;
};

export function AgentPanelHeader({ agent, onMouseDown, onClose }: Props) {
  return (
    <div
      onMouseDown={onMouseDown}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 14px",
        background: "var(--dpf-surface-2)",
        borderBottom: "1px solid var(--dpf-border)",
        borderRadius: "12px 12px 0 0",
        cursor: "grab",
        userSelect: "none",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400" />
          <span style={{ fontSize: 12, fontWeight: 600, color: "#e0e0ff" }}>
            {agent.agentName}
          </span>
        </div>
        <span style={{ fontSize: 10, color: "var(--dpf-muted)", marginLeft: 12 }}>
          {agent.agentDescription}
        </span>
      </div>

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
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
        ✕
      </button>
    </div>
  );
}
