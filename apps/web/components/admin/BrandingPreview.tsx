"use client";

import type { CSSProperties } from "react";

type Props = {
  companyName: string;
  logoUrl: string;
  accentColor: string;
  fontFamily: string;
  bgColor?: string;
  surface1Color?: string;
  borderColor?: string;
  mutedColor?: string;
};

function initialsFrom(name: string): string {
  const words = name.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "DPF";
  if (words.length === 1) return (words[0] ?? "").slice(0, 2);
  return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`;
}

export function BrandingPreview({
  companyName,
  logoUrl,
  accentColor,
  fontFamily,
  bgColor = "#0f0f1a",
  surface1Color = "#15151f",
  borderColor = "#2a2a3a",
  mutedColor = "#6b7280",
}: Props) {
  const cssVars = {
    "--preview-bg": bgColor,
    "--preview-surface1": surface1Color,
    "--preview-accent": accentColor,
    "--preview-border": borderColor,
    "--preview-muted": mutedColor,
    "--preview-font": fontFamily,
  } as CSSProperties;

  const hasLogo = logoUrl.trim().length > 0;
  const initials = initialsFrom(companyName || "DPF");
  const displayName = companyName.trim() || "Your Company";

  return (
    <div style={cssVars}>
      <div
        style={{
          background: "var(--preview-bg)",
          border: `1px solid var(--preview-border)`,
          borderRadius: "0.5rem",
          overflow: "hidden",
          fontFamily: "var(--preview-font)",
        }}
      >
        {/* Mock header bar */}
        <div
          style={{
            background: "var(--preview-surface1)",
            borderBottom: `1px solid var(--preview-border)`,
            padding: "10px 16px",
            display: "flex",
            alignItems: "center",
            gap: "10px",
          }}
        >
          {hasLogo ? (
            <img
              src={logoUrl}
              alt={`${displayName} logo`}
              style={{ width: "28px", height: "28px", objectFit: "contain", borderRadius: "4px" }}
            />
          ) : (
            <div
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "6px",
                background: "var(--preview-accent)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "10px",
                fontWeight: "bold",
                color: "#fff",
                flexShrink: 0,
              }}
            >
              {initials}
            </div>
          )}
          <span style={{ color: "#fff", fontWeight: 600, fontSize: "13px" }}>{displayName}</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: "12px" }}>
            {["Dashboard", "Products", "Settings"].map((label) => (
              <span key={label} style={{ fontSize: "11px", color: "var(--preview-muted)", cursor: "default" }}>
                {label}
              </span>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: "16px", background: "var(--preview-bg)" }}>
          {/* Sample card */}
          <div
            style={{
              background: "var(--preview-surface1)",
              border: `1px solid var(--preview-border)`,
              borderRadius: "8px",
              padding: "14px",
              marginBottom: "12px",
            }}
          >
            <p style={{ color: "#fff", fontWeight: 600, fontSize: "13px", marginBottom: "4px" }}>
              Sample card title
            </p>
            <p style={{ color: "var(--preview-muted)", fontSize: "11px", lineHeight: "1.5" }}>
              This is how secondary content will look. Your brand colors and typography apply throughout the platform.
            </p>
            <div
              style={{
                marginTop: "10px",
                height: "3px",
                width: "40px",
                background: "var(--preview-accent)",
                borderRadius: "2px",
              }}
            />
          </div>

          {/* Sample buttons */}
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button
              type="button"
              style={{
                background: "var(--preview-accent)",
                color: "#fff",
                border: "none",
                borderRadius: "6px",
                padding: "6px 14px",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "default",
                fontFamily: "var(--preview-font)",
              }}
            >
              Primary action
            </button>
            <button
              type="button"
              style={{
                background: "transparent",
                color: "var(--preview-accent)",
                border: `1px solid var(--preview-accent)`,
                borderRadius: "6px",
                padding: "6px 14px",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "default",
                fontFamily: "var(--preview-font)",
              }}
            >
              Secondary
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
