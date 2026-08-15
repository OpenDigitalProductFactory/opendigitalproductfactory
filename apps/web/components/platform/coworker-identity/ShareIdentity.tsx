"use client";
// apps/web/components/platform/coworker-identity/ShareIdentity.tsx
// EP-COWORKER-IDENTITY-360 Phase 2 — "Share this identity". The default face is
// human-useful (a copyable identity card + link); the machine-facing A2A
// agent-card endpoint sits behind a "for agents / developers" disclosure, never
// the front face (founder steer 2026-08-06). Client component: clipboard + toggle.
import { useState } from "react";
import { Share2, Link as LinkIcon, Copy, Check, Terminal } from "lucide-react";

export function ShareIdentity({
  displayName,
  role,
  summary,
  identityPath,
  agentCardPath,
}: {
  displayName: string;
  role: string;
  summary: string;
  /** App-relative identity page path, e.g. /workforce/AGT-WS-BUILD */
  identityPath: string;
  /** App-relative whole-coworker agent-card path. */
  agentCardPath: string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  function absolute(path: string): string {
    if (typeof window === "undefined") return path;
    return new URL(path, window.location.origin).toString();
  }

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600);
    } catch {
      /* clipboard unavailable — no-op */
    }
  }

  const cardText = `${displayName} — ${role}\n${summary}\n${absolute(identityPath)}`;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex min-h-11 items-center gap-2 rounded-md border border-[var(--dpf-border)] px-3 text-sm font-semibold text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)]"
      >
        <Share2 aria-hidden className="h-4 w-4" />
        Share
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={`Share ${displayName}`}
          className="absolute right-0 z-20 mt-2 w-[22rem] max-w-[90vw] overflow-hidden rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] shadow-lg"
        >
          {/* human-facing identity card */}
          <div className="border-b border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-4 py-3">
            <div className="text-sm font-bold text-[var(--dpf-text)]">{displayName}</div>
            <div className="text-dpf-caption text-[var(--dpf-muted)]">{role}</div>
            <p className="mt-1 text-dpf-caption leading-snug text-[var(--dpf-text-secondary)]">{summary}</p>
          </div>

          <div className="flex flex-wrap gap-2 px-4 py-3">
            <button
              type="button"
              onClick={() => copy("link", absolute(identityPath))}
              className="inline-flex min-h-11 items-center gap-2 rounded-md border border-[var(--dpf-accent)] bg-[var(--dpf-accent)] px-3 text-sm font-semibold text-[var(--dpf-accent-contrast,white)] hover:brightness-95"
            >
              {copied === "link" ? <Check aria-hidden className="h-4 w-4" /> : <LinkIcon aria-hidden className="h-4 w-4" />}
              {copied === "link" ? "Copied" : "Copy link"}
            </button>
            <button
              type="button"
              onClick={() => copy("card", cardText)}
              className="inline-flex min-h-11 items-center gap-2 rounded-md border border-[var(--dpf-border)] px-3 text-sm font-medium text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)]"
            >
              {copied === "card" ? <Check aria-hidden className="h-4 w-4" /> : <Copy aria-hidden className="h-4 w-4" />}
              {copied === "card" ? "Copied" : "Copy card"}
            </button>
          </div>

          {/* machine-facing endpoint — behind a disclosure, never the front face */}
          <details className="border-t border-[var(--dpf-border)] px-4 py-3">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-dpf-caption font-semibold text-[var(--dpf-muted)]">
              <Terminal aria-hidden className="h-3.5 w-3.5" />
              For agents &amp; developers
            </summary>
            <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2.5 py-2">
              <code className="truncate text-dpf-caption text-[var(--dpf-text-secondary)]">GET {agentCardPath}</code>
              <button
                type="button"
                onClick={() => copy("endpoint", absolute(agentCardPath))}
                aria-label="Copy agent-card endpoint"
                className="inline-flex h-7 w-7 flex-none items-center justify-center rounded text-[var(--dpf-muted)] hover:bg-[var(--dpf-surface-1)] hover:text-[var(--dpf-text)]"
              >
                {copied === "endpoint" ? <Check aria-hidden className="h-3.5 w-3.5" /> : <Copy aria-hidden className="h-3.5 w-3.5" />}
              </button>
            </div>
            <p className="mt-1.5 text-dpf-caption leading-snug text-[var(--dpf-faint,var(--dpf-muted))]">
              A standard A2A agent-card another agent resolves to discover this coworker&apos;s skills, offers, and how
              to engage it — the same identity you see here.
            </p>
          </details>
        </div>
      )}
    </div>
  );
}
