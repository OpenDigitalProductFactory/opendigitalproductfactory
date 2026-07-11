"use client";

// F10 (BI-1A75E068): one-click, phase-aware remediation for a build phase blocked
// with `no-eligible-endpoint`. Instead of a dead pointer, we name the currently-off
// provider(s) whose capabilities would satisfy this phase and offer to enable the
// one-click ones in place (reusing the existing toggleProviderStatus action). A
// candidate that still needs credentials/OAuth links to its setup page instead.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toggleProviderStatus } from "@/lib/actions/ai-providers";
import type { EnableCandidate } from "@/lib/inference/phase-enable-candidates";

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0px 6px",
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 600,
        background: "var(--dpf-surface-2)",
        color: "var(--dpf-muted)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function OneClickEnable({ candidate }: { candidate: EnableCandidate }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const router = useRouter();

  function handleEnable() {
    setError(null);
    setWarning(null);
    startTransition(async () => {
      try {
        const result = await toggleProviderStatus(candidate.providerId);
        if (result.warning) setWarning(result.warning);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not enable the provider.");
      }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--dpf-text)" }}>
          {candidate.displayName}
        </span>
        {candidate.satisfies.map((s) => (
          <Chip key={s}>{s}</Chip>
        ))}
        <button
          type="button"
          onClick={handleEnable}
          disabled={isPending}
          style={{
            background: "var(--dpf-accent)",
            color: "#fff",
            fontSize: 11,
            fontWeight: 600,
            padding: "3px 10px",
            borderRadius: 5,
            border: "none",
            cursor: isPending ? "default" : "pointer",
            opacity: isPending ? 0.6 : 1,
          }}
        >
          {isPending ? "Enabling…" : candidate.actionLabel}
        </button>
      </div>
      {warning && (
        <div role="alert" style={{ fontSize: 11, color: "var(--dpf-warning)", maxWidth: 420, lineHeight: 1.5 }}>
          {warning}
        </div>
      )}
      {error && (
        <div role="alert" style={{ fontSize: 11, color: "var(--dpf-error)", maxWidth: 420, lineHeight: 1.5 }}>
          {error}
        </div>
      )}
    </div>
  );
}

function CredentialCandidate({ candidate }: { candidate: EnableCandidate }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--dpf-text)" }}>
          {candidate.displayName}
        </span>
        {candidate.satisfies.map((s) => (
          <Chip key={s}>{s}</Chip>
        ))}
        <Link
          href={`/platform/ai/providers/${candidate.providerId}`}
          style={{ fontSize: 11, fontWeight: 600, color: "var(--dpf-accent)" }}
        >
          {candidate.actionLabel} →
        </Link>
      </div>
      {candidate.note && (
        <div style={{ fontSize: 11, color: "var(--dpf-muted)", lineHeight: 1.5 }}>{candidate.note}</div>
      )}
    </div>
  );
}

export function PhaseRemediationActions({ candidates }: { candidates: EnableCandidate[] }) {
  if (candidates.length === 0) return null;
  const oneWord = candidates.length === 1 ? "provider" : "providers";
  return (
    <div
      style={{
        marginTop: 8,
        paddingTop: 8,
        borderTop: "1px dashed var(--dpf-border)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--dpf-text)" }}>
        {candidates.length} disabled {oneWord} would resolve this phase:
      </div>
      {candidates.map((c) =>
        c.oneClick ? (
          <OneClickEnable key={c.providerId} candidate={c} />
        ) : (
          <CredentialCandidate key={c.providerId} candidate={c} />
        ),
      )}
    </div>
  );
}
