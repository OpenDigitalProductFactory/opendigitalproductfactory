"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toggleProviderStatus } from "@/lib/actions/ai-providers";
import type { EnableCandidate } from "@/lib/inference/phase-enable-candidates";

function CapabilityChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="whitespace-nowrap rounded-full bg-[var(--dpf-surface-2)] px-2 py-1 text-xs font-semibold text-[var(--dpf-muted)]">
      {children}
    </span>
  );
}

function CandidateIdentity({ candidate }: { candidate: EnableCandidate }) {
  return (
    <>
      <span className="text-sm font-semibold text-[var(--dpf-text)]">
        {candidate.displayName}
      </span>
      {candidate.satisfies.map((capability) => (
        <CapabilityChip key={capability}>{capability}</CapabilityChip>
      ))}
    </>
  );
}

function OneClickEnable({ candidate }: { candidate: EnableCandidate }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const router = useRouter();

  const enable = () => {
    setError(null);
    setWarning(null);
    startTransition(async () => {
      try {
        const result = await toggleProviderStatus(candidate.providerId);
        if (result.warning) setWarning(result.warning);
        router.refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not enable the provider.");
      }
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <CandidateIdentity candidate={candidate} />
        <button
          type="button"
          data-dpf-primary-action
          onClick={enable}
          disabled={isPending}
          className="dpf-tap-target rounded-lg bg-[var(--dpf-accent)] px-3 text-sm font-semibold text-[var(--dpf-on-accent,var(--dpf-surface-1))] disabled:cursor-wait disabled:opacity-60"
        >
          {isPending ? "Enabling…" : candidate.actionLabel}
        </button>
      </div>
      {warning ? (
        <p role="status" className="max-w-xl text-sm leading-6 text-[var(--dpf-warning)]">
          {warning}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="max-w-xl text-sm leading-6 text-[var(--dpf-error)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function CredentialCandidate({ candidate }: { candidate: EnableCandidate }) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <CandidateIdentity candidate={candidate} />
        <Link
          href={`/platform/ai/providers/${encodeURIComponent(candidate.providerId)}`}
          className="dpf-tap-target inline-flex items-center rounded-lg border border-[var(--dpf-accent)] px-3 text-sm font-semibold text-[var(--dpf-accent)] hover:bg-[var(--dpf-accent-soft)]"
        >
          {candidate.actionLabel}
        </Link>
      </div>
      {candidate.note ? (
        <p className="text-sm leading-6 text-[var(--dpf-muted)]">{candidate.note}</p>
      ) : null}
    </div>
  );
}

export function PhaseRemediationActions({ candidates }: { candidates: EnableCandidate[] }) {
  if (candidates.length === 0) return null;
  return (
    <section
      aria-label="Provider remediation options"
      className="mt-3 space-y-3 border-t border-dashed border-[var(--dpf-border)] pt-3"
    >
      <h5 className="text-sm font-semibold text-[var(--dpf-text)]">
        {candidates.length} disabled {candidates.length === 1 ? "provider" : "providers"} would satisfy this activity
      </h5>
      {candidates.map((candidate) =>
        candidate.oneClick ? (
          <OneClickEnable key={candidate.providerId} candidate={candidate} />
        ) : (
          <CredentialCandidate key={candidate.providerId} candidate={candidate} />
        ),
      )}
    </section>
  );
}
