"use client";
import { useState } from "react";

export type BrandExtractionInputs = {
  url?: string;
  includeCodebase: boolean;
};

type Props = {
  /** True when this single-install org may read the local platform codebase. */
  allowCodebaseSource: boolean;
  /** Called when the user clicks "Extract design system". */
  onExtract: (inputs: BrandExtractionInputs) => void;
  /** Called when the user clicks "Skip for now". */
  onSkip?: () => void;
  /** True when an extraction is currently running for this org. */
  busy?: boolean;
};

export function BrandExtractionForm({ allowCodebaseSource, onExtract, onSkip, busy = false }: Props) {
  const [url, setUrl] = useState("");
  const [includeCodebase, setIncludeCodebase] = useState(allowCodebaseSource);

  const hasSource = url.trim().length > 0 || (allowCodebaseSource && includeCodebase);
  const disabled = !hasSource || busy;

  return (
    <div
      className="border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        padding: 20,
        borderRadius: 8,
      }}
    >
      <div>
        <h2 className="text-[var(--dpf-text)]" style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>
          Build your design system
        </h2>
        <p className="text-[var(--dpf-muted)]" style={{ fontSize: 13, margin: "4px 0 0 0" }}>
          I'll extract your brand once and reuse it everywhere — storefront, admin, product UI.
          Give me any combination of sources.
        </p>
      </div>

      <label style={{ fontSize: 13 }}>
        <div className="text-[var(--dpf-text)]" style={{ fontWeight: 600, marginBottom: 4 }}>Website URL</div>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://yourbrand.com"
          disabled={busy}
          className="border border-[var(--dpf-border)] text-[var(--dpf-text)] bg-[var(--dpf-surface-2)]"
          style={{
            width: "100%",
            maxWidth: 420,
            padding: "8px 12px",
            borderRadius: 6,
            fontSize: 14,
          }}
        />
        <div className="text-[var(--dpf-muted)]" style={{ fontSize: 11, marginTop: 4 }}>
          I'll pull colors, typography, logos, and voice from whatever's on the page.
        </div>
      </label>

      {allowCodebaseSource && (
        <label className="text-[var(--dpf-text)]" style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
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
          onClick={() => onExtract({ url: url.trim() || undefined, includeCodebase: allowCodebaseSource && includeCodebase })}
          disabled={disabled}
          className={disabled ? "bg-[var(--dpf-border)] text-[var(--dpf-muted)]" : "bg-[var(--dpf-accent)] text-white"}
          style={{
            padding: "8px 20px",
            borderRadius: 6,
            border: "none",
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
            className="bg-transparent text-[var(--dpf-muted)]"
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "none",
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
