"use client";

import React from "react";

type SerializedLink = {
  id: string;
  chainId: string;
  depth: number;
  fromAgentId: string;
  toAgentId: string;
  skillId: string | null;
  authorityScope: string[];
  originUserId: string;
  originAuthority: string[];
  status: string;
  reason: string | null;
  parentLinkId: string | null;
  startedAt: string;
  completedAt: string | null;
};

function StatusIndicator({ status }: { status: string }) {
  if (status === "blocked" || status === "failed") {
    return (
      <span style={{ color: "var(--dpf-error, #ef4444)", fontWeight: 600 }}>
        [X]
      </span>
    );
  }
  if (status === "completed") {
    return (
      <span style={{ color: "var(--dpf-success, #22c55e)", fontWeight: 600 }}>
        [done]
      </span>
    );
  }
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        backgroundColor: "var(--dpf-accent, #3b82f6)",
        animation: "dpf-pulse 1.5s ease-in-out infinite",
        verticalAlign: "middle",
        marginRight: 6,
      }}
    />
  );
}

function AuthorityTags({ scopes }: { scopes: string[] }) {
  if (scopes.length === 0) return <span style={{ color: "var(--dpf-muted, #9ca3af)" }}>none</span>;
  return (
    <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {scopes.map((s) => (
        <span
          key={s}
          style={{
            fontSize: 11,
            padding: "1px 6px",
            borderRadius: 4,
            backgroundColor: "var(--dpf-surface, #1e293b)",
            border: "1px solid var(--dpf-border, #334155)",
            color: "var(--dpf-text-secondary, #cbd5e1)",
          }}
        >
          {s}
        </span>
      ))}
    </span>
  );
}

export default function DelegationChainView({ links }: { links: SerializedLink[] }) {
  if (links.length === 0) {
    return <div style={{ color: "var(--dpf-muted, #9ca3af)" }}>No delegation chain.</div>;
  }

  const originUser = links[0].originUserId;
  const totalOriginAuth = links[0].originAuthority.length;

  return (
    <div style={{ fontFamily: "var(--dpf-font, inherit)", fontSize: 13 }}>
      <style>{`@keyframes dpf-pulse { 0%,100% { opacity:1 } 50% { opacity:0.3 } }`}</style>

      {/* Origin node */}
      <div style={{ padding: "6px 0", color: "var(--dpf-text, #f1f5f9)" }}>
        User: <strong>{originUser}</strong> ({totalOriginAuth} capabilities)
      </div>

      {links.map((link, i) => {
        const isBlocked = link.status === "blocked" || link.status === "failed";
        const borderColor = isBlocked
          ? "var(--dpf-error, #ef4444)"
          : "var(--dpf-border, #334155)";

        return (
          <div key={link.id}>
            {/* Connector line */}
            <div
              style={{
                width: 2,
                height: 16,
                backgroundColor: borderColor,
                marginLeft: 12,
              }}
            />

            {/* Link card */}
            <div
              style={{
                border: `1px solid ${borderColor}`,
                borderRadius: 6,
                padding: "8px 12px",
                backgroundColor: isBlocked
                  ? "var(--dpf-error-bg, rgba(239,68,68,0.08))"
                  : "var(--dpf-card, #0f172a)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 4,
                }}
              >
                <StatusIndicator status={link.status} />
                <span style={{ color: "var(--dpf-text, #f1f5f9)" }}>
                  <strong>{link.fromAgentId}</strong>
                  {" -> "}
                  <strong>{link.toAgentId}</strong>
                </span>
                {link.skillId && (
                  <span style={{ color: "var(--dpf-text-secondary, #cbd5e1)", fontSize: 11 }}>
                    via {link.skillId}
                  </span>
                )}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                <span style={{ color: "var(--dpf-muted, #9ca3af)", fontSize: 11 }}>
                  Authority ({link.authorityScope.length}
                  {i > 0 ? ` of ${links[i - 1].authorityScope.length}` : ` of ${totalOriginAuth}`}):
                </span>
                <AuthorityTags scopes={link.authorityScope} />
              </div>

              {isBlocked && link.reason && (
                <div style={{ color: "var(--dpf-error, #ef4444)", fontSize: 12, marginTop: 4 }}>
                  {link.reason}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
