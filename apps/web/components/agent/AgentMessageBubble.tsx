"use client";

import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import type { AgentMessageRow } from "@/lib/agent-coworker-types";
import { AgentAttachmentCard } from "./AgentAttachmentCard";

type Props = {
  message: AgentMessageRow;
  showAgentLabel: boolean;
  agentName: string | null;
  onApprove?: (proposalId: string) => void;
  onReject?: (proposalId: string) => void;
  deliveryState?: "sending" | "sent" | "failed";
  onRetry?: () => void;
};

// Human-friendly labels for proposal parameters
const PARAM_LABELS: Record<string, string> = {
  title: "Title",
  description: "Description",
  name: "Name",
  portfolioContext: "Portfolio",
  portfolioSlug: "Portfolio",
  targetRoles: "For",
  dataNeeds: "Data",
  acceptanceCriteria: "Done when",
  inputs: "Inputs",
  versionBump: "Version bump",
};

// Keys to hide from proposal display (internal system values)
const HIDDEN_PARAMS = new Set(["buildId", "digitalProductId", "featureBrief"]);

function formatProposalParams(
  actionType: string,
  params: Record<string, unknown>,
): React.ReactNode {
  const entries = Object.entries(params).filter(([k]) => !HIDDEN_PARAMS.has(k));
  if (entries.length === 0) return null;

  return entries.map(([k, v]) => {
    const label = PARAM_LABELS[k] ?? k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
    let display: string;
    if (Array.isArray(v)) {
      display = v.join(", ");
    } else {
      display = String(v ?? "");
    }
    // Truncate very long values
    if (display.length > 120) display = display.slice(0, 117) + "...";
    return (
      <div key={k} style={{ marginBottom: 2 }}>
        <span style={{ color: "var(--dpf-muted)", fontWeight: 500 }}>{label}:</span>{" "}
        <span style={{ color: "var(--dpf-text)" }}>{display}</span>
      </div>
    );
  });
}

const MARKDOWN_COMPONENTS: Components = {
  p: ({ children }) => <p style={{ margin: "0 0 8px 0" }}>{children}</p>,
  ul: ({ children }) => <ul style={{ margin: "0 0 8px 18px", padding: 0 }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ margin: "0 0 8px 18px", padding: 0 }}>{children}</ol>,
  li: ({ children }) => <li style={{ marginBottom: 4 }}>{children}</li>,
  strong: ({ children }) => <strong style={{ fontWeight: 700, color: "var(--dpf-text)" }}>{children}</strong>,
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
          background: "color-mix(in srgb, var(--dpf-text) 8%, transparent)",
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
        background: "color-mix(in srgb, var(--dpf-bg) 22%, transparent)",
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

export function AgentMessageBubble({
  message,
  showAgentLabel,
  agentName,
  onApprove,
  onReject,
  deliveryState,
  onRetry,
}: Props) {
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
        : "color-mix(in srgb, var(--dpf-accent) 40%, transparent)";

    const actionLabel = p.actionType
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

    // Special rendering for file change proposals
    if (p.actionType === "propose_file_change") {
      const filePath = p.parameters.path as string;
      const description = p.parameters.description as string;
      const diff = (p.parameters as Record<string, unknown>).diff as string | undefined;
      const isApproved = isExecuted;

      return (
        <div style={{ marginBottom: 12 }}>
          {message.content && (
            <div style={{ padding: "8px 12px", borderRadius: "12px 12px 12px 2px", fontSize: 13, lineHeight: 1.4, background: "color-mix(in srgb, var(--dpf-surface-1) 80%, transparent)", color: "var(--dpf-text)", marginBottom: 6 }}>
              {message.content}
            </div>
          )}
          <div style={{
            background: "color-mix(in srgb, var(--dpf-surface-2) 90%, transparent)",
            border: `1px solid ${borderColor}`,
            borderRadius: 10, padding: "10px 14px", fontSize: 12,
          }}>
            <div style={{ fontWeight: 600, color: "var(--dpf-text)", marginBottom: 4 }}>
              Propose File Change
            </div>
            <div style={{ fontFamily: "monospace", fontSize: 11, color: "var(--dpf-accent)", marginBottom: 4 }}>
              {filePath}
            </div>
            <div style={{ color: "var(--dpf-muted)", fontSize: 11, marginBottom: 8 }}>
              {description}
            </div>
            {diff && (
              <pre style={{
                background: "var(--dpf-bg)", borderRadius: 6, padding: 8, fontSize: 10,
                fontFamily: "monospace", lineHeight: 1.5, overflow: "auto", maxHeight: 300,
                border: "1px solid var(--dpf-border)", margin: "0 0 8px",
              }}>
                {diff.split("\n").map((line, i) => {
                  const colour = line.startsWith("+") && !line.startsWith("+++") ? "#4ade80"
                    : line.startsWith("-") && !line.startsWith("---") ? "#ef4444"
                    : line.startsWith("@@") ? "var(--dpf-accent)"
                    : "var(--dpf-muted)";
                  return (
                    <div key={i} style={{ color: colour }}>
                      {line}
                    </div>
                  );
                })}
              </pre>
            )}
            {isPending && (
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" onClick={() => onApprove?.(p.proposalId)} style={{ flex: 1, background: "rgba(74,222,128,0.2)", border: "1px solid rgba(74,222,128,0.4)", borderRadius: 6, padding: "5px 10px", fontSize: 11, color: "#4ade80", cursor: "pointer" }}>
                  Approve &amp; Apply
                </button>
                <button type="button" onClick={() => onReject?.(p.proposalId)} style={{ flex: 1, background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 6, padding: "5px 10px", fontSize: 11, color: "#ef4444", cursor: "pointer" }}>
                  Reject
                </button>
              </div>
            )}
            {isApproved && <div style={{ color: "#4ade80", fontSize: 11, marginTop: 6 }}>Applied to {filePath}</div>}
            {isRejected && <div style={{ color: "#ef4444", fontSize: 11, marginTop: 6 }}>Rejected</div>}
            {isFailed && <div style={{ color: "#ef4444", fontSize: 11, marginTop: 6 }}>Failed: {p.resultError}</div>}
          </div>
        </div>
      );
    }

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
                background: "color-mix(in srgb, var(--dpf-surface-1) 80%, transparent)",
                color: "var(--dpf-text)",
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
              background: "color-mix(in srgb, var(--dpf-surface-2) 90%, transparent)",
              border: `1px solid ${borderColor}`,
              borderRadius: 10,
              padding: "10px 14px",
              fontSize: 12,
            }}
          >
            <div style={{ fontWeight: 600, color: "var(--dpf-text)", marginBottom: 6 }}>
              {actionLabel}
            </div>
            <div style={{ color: "var(--dpf-muted)", fontSize: 11, marginBottom: 8, lineHeight: 1.5 }}>
              {formatProposalParams(p.actionType, p.parameters)}
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
          background: isUser ? "var(--dpf-accent)" : "color-mix(in srgb, var(--dpf-surface-1) 80%, transparent)",
          color: "var(--dpf-text)",
          wordBreak: "break-word",
          opacity: isUser && deliveryState === "sending" ? 0.74 : 1,
        }}
      >
        {isUser ? (
          message.content
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            <ReactMarkdown components={MARKDOWN_COMPONENTS}>{message.content}</ReactMarkdown>
          </div>
        )}
        {message.attachments && message.attachments.length > 0 && (
          <div style={{ marginTop: 4 }}>
            {message.attachments.map((att) => (
              <AgentAttachmentCard key={att.id} attachment={att} />
            ))}
          </div>
        )}
      </div>
      {isUser && deliveryState && deliveryState !== "sent" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 11,
            color: "var(--dpf-muted)",
            marginRight: 4,
          }}
        >
          <span>{deliveryState === "sending" ? "Sending..." : "Not sent"}</span>
          {deliveryState === "failed" && onRetry && (
            <button
              type="button"
              onClick={onRetry}
              style={{
                background: "none",
                border: "1px solid color-mix(in srgb, var(--dpf-text) 12%, transparent)",
                borderRadius: 999,
                color: "var(--dpf-text)",
                cursor: "pointer",
                fontSize: 11,
                lineHeight: 1,
                padding: "3px 8px",
              }}
            >
              Retry
            </button>
          )}
        </div>
      )}
    </div>
  );
}
