"use client";

import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import type { AgentMessageRow } from "@/lib/agent-coworker-types";

type Props = {
  message: AgentMessageRow;
  showAgentLabel: boolean;
  agentName: string | null;
  onApprove?: (proposalId: string) => void;
  onReject?: (proposalId: string) => void;
};

const MARKDOWN_COMPONENTS: Components = {
  p: ({ children }) => <p style={{ margin: "0 0 8px 0" }}>{children}</p>,
  ul: ({ children }) => <ul style={{ margin: "0 0 8px 18px", padding: 0 }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ margin: "0 0 8px 18px", padding: 0 }}>{children}</ol>,
  li: ({ children }) => <li style={{ marginBottom: 4 }}>{children}</li>,
  strong: ({ children }) => <strong style={{ fontWeight: 700, color: "#ffffff" }}>{children}</strong>,
  em: ({ children }) => <em style={{ fontStyle: "italic" }}>{children}</em>,
  h1: ({ children }) => (
    <h1 style={{ margin: "0 0 8px 0", fontSize: 16, fontWeight: 700, lineHeight: 1.3 }}>{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 style={{ margin: "0 0 8px 0", fontSize: 15, fontWeight: 700, lineHeight: 1.3 }}>{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 style={{ margin: "0 0 6px 0", fontSize: 14, fontWeight: 700, lineHeight: 1.3 }}>{children}</h3>
  ),
  code: ({ children, className, ...props }) => {
    const inline = !className;
    return inline ? (
      <code
        {...props}
        style={{
          background: "rgba(255,255,255,0.08)",
          borderRadius: 4,
          padding: "1px 4px",
          fontSize: 12,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        }}
      >
        {children}
      </code>
    ) : (
      <code className={className} {...props}>{children}</code>
    );
  },
  pre: ({ children }) => (
    <pre
      style={{
        margin: "0 0 8px 0",
        padding: "8px 10px",
        background: "rgba(0,0,0,0.22)",
        borderRadius: 8,
        overflowX: "auto",
        fontSize: 12,
        lineHeight: 1.45,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      }}
    >
      {children}
    </pre>
  ),
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

export function AgentMessageBubble({ message, showAgentLabel, agentName, onApprove, onReject }: Props) {
  if (message.role === "system") {
    return (
      <div
        style={{
          textAlign: "center",
          padding: "8px 0",
          fontSize: 11,
          color: "var(--dpf-muted)",
          fontStyle: "italic",
        }}
      >
        {message.content}
      </div>
    );
  }

  const isUser = message.role === "user";

  // Proposal card rendering for assistant messages with a proposal
  if (!isUser && message.proposal) {
    const p = message.proposal;
    const isPending = p.status === "proposed";
    const isExecuted = p.status === "executed";
    const isRejected = p.status === "rejected";
    const isFailed = p.status === "failed";

    const borderColor = isExecuted
      ? "rgba(74,222,128,0.4)"
      : isRejected || isFailed
        ? "rgba(239,68,68,0.4)"
        : "rgba(124,140,248,0.4)";

    const actionLabel = p.actionType
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 2,
          marginBottom: 8,
        }}
      >
        {showAgentLabel && agentName && (
          <span style={{ fontSize: 10, color: "var(--dpf-accent)", marginLeft: 4 }}>
            {agentName}
          </span>
        )}
        <div style={{ maxWidth: "85%" }}>
          {/* Show the text content first if any */}
          {message.content && (
            <div
              title={formatRelativeTime(message.createdAt)}
              style={{
                padding: "8px 12px",
                borderRadius: "12px 12px 12px 2px",
                fontSize: 13,
                lineHeight: 1.4,
                background: "rgba(22, 22, 37, 0.8)",
                color: "#e0e0ff",
                marginBottom: 6,
                wordBreak: "break-word",
              }}
            >
              {message.content}
            </div>
          )}
          {/* Proposal card */}
          <div
            style={{
              background: "rgba(26, 26, 46, 0.9)",
              border: `1px solid ${borderColor}`,
              borderRadius: 10,
              padding: "10px 14px",
              fontSize: 12,
            }}
          >
            <div style={{ fontWeight: 600, color: "#e0e0ff", marginBottom: 6 }}>
              {actionLabel}
            </div>
            <div style={{ color: "var(--dpf-muted)", fontSize: 11, marginBottom: 8 }}>
              {Object.entries(p.parameters).map(([k, v]) => (
                <div key={k}>
                  <span style={{ color: "#8888a0" }}>{k}:</span>{" "}
                  {String(v)}
                </div>
              ))}
            </div>
            {isPending && (
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  onClick={() => onApprove?.(p.proposalId)}
                  style={{
                    flex: 1,
                    background: "rgba(74,222,128,0.2)",
                    border: "1px solid rgba(74,222,128,0.4)",
                    borderRadius: 6,
                    padding: "5px 10px",
                    fontSize: 11,
                    color: "#4ade80",
                    cursor: "pointer",
                  }}
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => onReject?.(p.proposalId)}
                  style={{
                    flex: 1,
                    background: "rgba(239,68,68,0.15)",
                    border: "1px solid rgba(239,68,68,0.3)",
                    borderRadius: 6,
                    padding: "5px 10px",
                    fontSize: 11,
                    color: "#ef4444",
                    cursor: "pointer",
                  }}
                >
                  Reject
                </button>
              </div>
            )}
            {isExecuted && (
              <div style={{ color: "#4ade80", fontSize: 11 }}>
                ✓ Approved{p.resultEntityId ? ` — Created ${p.resultEntityId}` : ""}
              </div>
            )}
            {isRejected && (
              <div style={{ color: "#ef4444", fontSize: 11 }}>✕ Rejected</div>
            )}
            {isFailed && (
              <div style={{ color: "#ef4444", fontSize: 11 }}>
                ⚠ Failed: {p.resultError}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
        gap: 2,
        marginBottom: 8,
      }}
    >
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
          lineHeight: 1.5,
          background: isUser ? "var(--dpf-accent)" : "rgba(22, 22, 37, 0.8)",
          color: isUser ? "#ffffff" : "#e0e0ff",
          wordBreak: "break-word",
        }}
      >
        {isUser ? (
          message.content
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            <ReactMarkdown components={MARKDOWN_COMPONENTS}>{message.content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
