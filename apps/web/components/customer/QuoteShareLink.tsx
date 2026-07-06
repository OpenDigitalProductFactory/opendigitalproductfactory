"use client";

import { useState } from "react";

// The customer-facing accept link for a sent quote — the delivery rail.
// Mirrors how the invoice pay link is shared; one copy button, no email infra.
export function QuoteShareLink({ acceptToken }: { acceptToken: string }) {
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const url =
    typeof window !== "undefined"
      ? `${window.location.origin}/s/quote/${acceptToken}`
      : `/s/quote/${acceptToken}`;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
      <span className="text-[var(--dpf-muted)]">Customer accept link:</span>
      <code className="max-w-72 truncate rounded bg-[var(--dpf-surface-2)] px-2 py-1 font-mono text-[11px] text-[var(--dpf-text)]">
        {revealed ? url : `/s/quote/${acceptToken.slice(0, 10)}…`}
      </code>
      <button
        className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-[11px] text-[var(--dpf-text)] hover:border-[var(--dpf-accent)]"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            // Clipboard unavailable — reveal the full URL inline for manual copy.
            setCopied(false);
            setRevealed(true);
          }
        }}
      >
        {copied ? "Copied ✓" : "Copy link"}
      </button>
    </div>
  );
}
