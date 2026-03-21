// apps/web/components/platform/McpServiceRow.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import type { McpServerGridRow } from "@/lib/ai-provider-types";

const HEALTH_COLORS: Record<string, string> = {
  healthy:     "#4ade80",
  degraded:    "#fbbf24",
  unhealthy:   "#ef4444",
  unreachable: "#ef4444",
  unknown:     "#8888a0",
};

const TRANSPORT_LABELS: Record<string, string> = {
  stdio: "STDIO",
  sse:   "SSE",
  http:  "HTTP",
};

export function McpServiceRow({ server }: { server: McpServerGridRow }) {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);

  const healthColor = HEALTH_COLORS[server.healthStatus] ?? HEALTH_COLORS.unknown;

  return (
    <div style={{ borderBottom: "1px solid var(--dpf-border, #2a2a40)" }}>
      {/* Collapsed row */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setExpanded((v) => !v); }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px",
          cursor: "pointer",
          background: hovered ? "var(--dpf-surface-2, #1a1a2e)" : "transparent",
          transition: "background 0.1s",
        }}
      >
        {/* Health dot */}
        <span
          title={server.healthStatus}
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: healthColor,
            flexShrink: 0,
          }}
        />

        {/* Name */}
        <span
          style={{
            color: "var(--dpf-text)",
            fontSize: 11,
            fontWeight: 600,
            flex: "1 1 0",
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {server.name}
        </span>

        {/* Transport badge */}
        {server.transport && (
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.06em",
              color: "#a78bfa",
              background: "#a78bfa18",
              padding: "1px 5px",
              borderRadius: 3,
              textTransform: "uppercase",
              flexShrink: 0,
            }}
          >
            {TRANSPORT_LABELS[server.transport] ?? server.transport}
          </span>
        )}

        {/* Tool count */}
        <span
          style={{
            fontSize: 10,
            color: "var(--dpf-muted)",
            flexShrink: 0,
            fontFamily: "monospace",
          }}
        >
          {server.enabledToolCount}/{server.toolCount} tools
        </span>

        {/* Category */}
        {server.integrationCategory && (
          <span
            className="hidden sm:inline"
            style={{ color: "var(--dpf-muted)", fontSize: 10, flexShrink: 0 }}
          >
            {server.integrationCategory}
          </span>
        )}
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div
          style={{
            padding: "10px 14px 12px 26px",
            background: "var(--dpf-surface-1, #13131f)",
            borderTop: "1px solid var(--dpf-border, #2a2a40)",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
              gap: "6px 16px",
              marginBottom: 10,
            }}
          >
            <DetailItem label="Server ID" value={server.serverId} mono />
            <DetailItem label="Health" value={server.healthStatus} />
            <DetailItem label="Transport" value={server.transport ?? "—"} />
            <DetailItem
              label="Last Health Check"
              value={server.lastHealthCheck ? new Date(server.lastHealthCheck).toLocaleString() : "Never"}
            />
            <DetailItem label="Tool Namespace" value={`${server.serverId}__*`} mono />
            {server.activatedAt && (
              <DetailItem
                label="Activated"
                value={new Date(server.activatedAt).toLocaleDateString()}
              />
            )}
          </div>

          {/* Tags */}
          {server.tags.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
              <span style={{ color: "var(--dpf-muted)", fontSize: 10, marginRight: 4, alignSelf: "center" }}>Tags:</span>
              {server.tags.map((tag) => (
                <span
                  key={tag}
                  style={{
                    fontSize: 10,
                    color: "#a0a0c0",
                    background: "#ffffff0a",
                    border: "1px solid var(--dpf-border)",
                    padding: "1px 6px",
                    borderRadius: 3,
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Links */}
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Link
              href={`/platform/services/${server.id}`}
              style={{ color: "var(--dpf-accent)", fontSize: 10 }}
            >
              Manage Tools →
            </Link>
            {server.integrationName && (
              <Link
                href="/platform/integrations"
                style={{ color: "var(--dpf-muted)", fontSize: 10 }}
              >
                View in Catalog
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div style={{ color: "var(--dpf-muted)", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>
        {label}
      </div>
      <div
        style={{
          color: "var(--dpf-muted)",
          fontSize: 10,
          fontFamily: mono ? "monospace" : undefined,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}
