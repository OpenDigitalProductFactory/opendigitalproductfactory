"use client";

import type { AgentInfo } from "@/lib/agent-coworker-types";
import type { UserContext } from "@/lib/permissions";
import { AgentSkillsDropdown } from "./AgentSkillsDropdown";

type Props = {
  agent: AgentInfo;
  userContext: UserContext;
  onSend: (content: string) => void;
  onClose: () => void;
};

export function AgentPanelHeader({ agent, userContext, onSend, onClose }: Props) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 14px",
        background: "rgba(22, 22, 37, 0.8)",
        borderBottom: "1px solid rgba(42, 42, 64, 0.6)",
        borderRadius: "12px 12px 0 0",
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
        <span style={{ fontSize: 10, color: "var(--dpf-muted)", marginLeft: 12 }}>
          {agent.agentDescription}
        </span>
      </div>

      <button
        type="button"
        onClick={onClose}
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
