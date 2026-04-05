// apps/web/components/platform/OAuthConnectionStatus.tsx
"use client";

import type { CredentialRow } from "@/lib/ai-provider-types";

function relativeTime(isoDate: string): string {
  const diff = new Date(isoDate).getTime() - Date.now();
  const absDiff = Math.abs(diff);
  const minutes = Math.floor(absDiff / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  let label: string;
  if (days > 0) label = `${days}d ${hours % 24}h`;
  else if (hours > 0) label = `${hours}h ${minutes % 60}m`;
  else label = `${minutes}m`;

  return diff > 0 ? `expires in ${label}` : `expired ${label} ago`;
}

type Props = {
  credential: CredentialRow;
  authMethod: string;
  authorizeUrl: string | null;
  providerId: string;
};

export function OAuthConnectionStatus({ credential, authMethod, authorizeUrl, providerId }: Props) {
  if (authMethod !== "oauth2_authorization_code") return null;

  const isConnected = (credential.status === "configured" || credential.status === "ok") && credential.tokenExpiresAt;
  const isExpired = credential.tokenExpiresAt
    ? new Date(credential.tokenExpiresAt).getTime() < Date.now()
    : false;

  return (
    <div
      style={{
        background: "var(--dpf-surface-1)",
        border: "1px solid var(--dpf-border)",
        borderRadius: 6,
        padding: "12px 16px",
        marginBottom: 16,
      }}
    >
      <div style={{ fontSize: 10, color: "var(--dpf-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
        OAuth Connection
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {/* Status indicator */}
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: isConnected && !isExpired ? "var(--dpf-success)" : "var(--dpf-warning)",
            flexShrink: 0,
          }}
        />

        {/* Status text */}
        <span style={{ fontSize: 12, color: "var(--dpf-text)" }}>
          {isConnected && !isExpired
            ? `Connected · ${relativeTime(credential.tokenExpiresAt!)}`
            : isExpired
              ? "Token expired"
              : "Not connected"}
        </span>

        {/* Refresh token indicator */}
        {credential.hasRefreshToken && (
          <span
            style={{
              fontSize: 9,
              color: "var(--dpf-success)",
              background: "color-mix(in srgb, var(--dpf-success) 10%, transparent)",
              padding: "1px 5px",
              borderRadius: 3,
            }}
          >
            auto-refresh
          </span>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        {(!isConnected || isExpired) && authorizeUrl && (
          <a
            href={`/api/oauth/authorize/${providerId}`}
            style={{
              fontSize: 11,
              color: "var(--dpf-accent)",
              padding: "4px 10px",
              border: "1px solid var(--dpf-accent)",
              borderRadius: 4,
              textDecoration: "none",
            }}
          >
            Sign in
          </a>
        )}
      </div>
    </div>
  );
}
