"use client";

import type { AgentMessageRow } from "@/lib/agent-coworker-types";

type Props = {
  message: AgentMessageRow;
  showAgentLabel: boolean; // true when agent changed from previous message
  agentName: string | null;
};

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function AgentMessageBubble({ message, showAgentLabel, agentName }: Props) {
  if (message.role === "system") {
    return (
      <div style={{
        textAlign: "center",
        padding: "8px 0",
        fontSize: 11,
        color: "var(--dpf-muted)",
        fontStyle: "italic",
      }}>
        {message.content}
      </div>
    );
  }

  const isUser = message.role === "user";

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: isUser ? "flex-end" : "flex-start",
      gap: 2,
      marginBottom: 8,
    }}>
      {showAgentLabel && agentName && !isUser && (
        <span style={{ fontSize: 10, color: "var(--dpf-accent)", marginLeft: 4 }}>
          {agentName}
        </span>
      )}
      <div
        title={formatRelativeTime(message.createdAt)}
        style={{
          maxWidth: "85%",
          padding: "8px 12px",
          borderRadius: isUser ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
          fontSize: 13,
          lineHeight: 1.4,
          background: isUser ? "var(--dpf-accent)" : "rgba(22, 22, 37, 0.8)",
          color: isUser ? "#ffffff" : "#e0e0ff",
          wordBreak: "break-word",
        }}
      >
        {message.content}
      </div>
    </div>
  );
}
