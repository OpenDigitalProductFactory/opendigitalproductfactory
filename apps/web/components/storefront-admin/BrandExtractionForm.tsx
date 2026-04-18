"use client";
import { useState } from "react";

export type BrandExtractionInputs = {
  url?: string;
  includeCodebase: boolean;
};

type Props = {
  /** True only for the platform org (codebase-adapter scoping rule). */
  isPlatformOrg: boolean;
  /** Called when the user clicks "Extract design system". */
  onExtract: (inputs: BrandExtractionInputs) => void;
  /** Called when the user clicks "Skip for now". */
  onSkip?: () => void;
  /** True when an extraction is currently running for this org. */
  busy?: boolean;
};

export function BrandExtractionForm({ isPlatformOrg, onExtract, onSkip, busy = false }: Props) {
  const [url, setUrl] = useState("");
  const [includeCodebase, setIncludeCodebase] = useState(isPlatformOrg);

  const hasSource = url.trim().length > 0 || (isPlatformOrg && includeCodebase);
  const disabled = !hasSource || busy;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: 20,
        borderRadius: 8,
        border: "1px solid var(--dpf-border)",
        background: "var(--dpf-surface-1)",
      }}
    >
      <div>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: "var(--dpf-text)" }}>
          Build your design system
        </h2>
        <p style={{ fontSize: 13, color: "var(--dpf-muted)", margin: "4px 0 0 0" }}>
          I'll extract your brand once and reuse it everywhere — storefront, admin, product UI.
          Give me any combination of sources.
        </p>
      </div>

      <label style={{ fontSize: 13 }}>
        <div style={{ fontWeight: 600, marginBottom: 4, color: "var(--dpf-text)" }}>Website URL</div>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://yourbrand.com"
          disabled={busy}
          style={{
            width: "100%",
            maxWidth: 420,
            padding: "8px 12px",
            borderRadius: 6,
            border: "1px solid var(--dpf-border)",
            fontSize: 14,
            color: "var(--dpf-text)",
            background: "var(--dpf-surface-2)",
          }}
        />
        <div style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 4 }}>
          I'll pull colors, typography, logos, and voice from whatever's on the page.
        </div>
      </label>

      {isPlatformOrg && (
        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 8, color: "var(--dpf-text)" }}>
          <input
            type="checkbox"
            checked={includeCodebase}
            onChange={(e) => setIncludeCodebase(e.target.checked)}
            disabled={busy}
          />
          <span>
            Also read the connected codebase (tailwind config, CSS variables, components).
          </span>
        </label>
      )}

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 4 }}>
        <button
          type="button"
          onClick={() => onExtract({ url: url.trim() || undefined, includeCodebase: isPlatformOrg && includeCodebase })}
          disabled={disabled}
          style={{
            padding: "8px 20px",
            borderRadius: 6,
            border: "none",
            background: disabled ? "var(--dpf-border)" : "var(--dpf-accent)",
            color: disabled ? "var(--dpf-muted)" : "#fff",
            cursor: disabled ? "not-allowed" : "pointer",
            fontSize: 13,
            fontWeight: 600,
            opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? "Working on it..." : "Extract design system"}
        </button>
        {onSkip && (
          <button
            type="button"
            onClick={onSkip}
            disabled={busy}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "none",
              background: "transparent",
              color: "var(--dpf-muted)",
              cursor: busy ? "not-allowed" : "pointer",
              fontSize: 13,
              textDecoration: "underline",
            }}
          >
            Skip for now
          </button>
        )}
      </div>
    </div>
  );
}
