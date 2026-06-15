"use client";

import { useState } from "react";
import {
  fileUpstreamFeedback,
  getUpstreamFeedbackConsent,
  setUpstreamFeedbackOptIn,
  type FileUpstreamFeedbackResult,
} from "@/lib/actions/feedback-escalation";

type EscalatePhase = "idle" | "checking" | "consenting" | "sending" | "done";

/**
 * "Report to the project team" affordance — the user-facing entry to upstream
 * feedback escalation (BI-6D45BA27). Opt-in: first use shows a consent prompt
 * explaining the redacted, pseudonymous submission; consent is recorded
 * locally. Hidden entirely for installs that keep everything private
 * (fork_only) or where contributions are paused.
 *
 * Used by FeedbackForm (after any manual report) and the crash error boundary
 * (after an auto-filed crash report or a user-submitted crash description).
 */
export function UpstreamEscalation({ reportId }: { reportId: string }) {
  const [phase, setPhase] = useState<EscalatePhase>("idle");
  const [result, setResult] = useState<FileUpstreamFeedbackResult | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  async function fileNow() {
    setPhase("sending");
    const r = await fileUpstreamFeedback({ reportId });
    setResult(r);
    setPhase("done");
  }

  async function handleStart() {
    setPhase("checking");
    const consent = await getUpstreamFeedbackConsent();
    if (consent.forkOnly || consent.paused) {
      setUnavailable(true);
      setPhase("idle");
      return;
    }
    if (!consent.optIn) {
      setPhase("consenting");
      return;
    }
    await fileNow();
  }

  async function handleConsentAccept() {
    setPhase("sending");
    await setUpstreamFeedbackOptIn({ enabled: true });
    await fileNow();
  }

  if (unavailable) {
    return (
      <div className="mt-3 text-xs text-[var(--dpf-muted)]">
        Sharing with the project team is turned off for this install.
      </div>
    );
  }

  if (phase === "done" && result) {
    if (result.ok && (result.status === "filed" || result.status === "already-filed")) {
      return (
        <div className="mt-3 text-xs text-[var(--dpf-text)]">
          Sent to the project team.{" "}
          {result.url && (
            <a
              href={result.url}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--dpf-accent)] underline"
            >
              View issue
            </a>
          )}
        </div>
      );
    }
    return (
      <div className="mt-3 text-xs text-[var(--dpf-muted)]">
        Couldn&apos;t send to the project team: {result.reason}
      </div>
    );
  }

  if (phase === "consenting") {
    return (
      <div className="mt-3 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2.5 text-left text-xs text-[var(--dpf-text)]">
        <p className="mb-2">
          Send this report to the project team? It&apos;s submitted under your
          install&apos;s anonymous handle, with machine names removed. Your real
          identity stays on this install. We&apos;ll remember your choice.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleConsentAccept}
            className="flex-1 rounded-md bg-[var(--dpf-accent)] px-3 py-1.5 text-xs text-white"
          >
            Send &amp; remember
          </button>
          <button
            type="button"
            onClick={() => setPhase("idle")}
            className="rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-xs text-[var(--dpf-text)]"
          >
            Not now
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={handleStart}
      disabled={phase === "checking" || phase === "sending"}
      className="mt-3 block w-full rounded-md border border-[var(--dpf-border)] px-3 py-1.5 text-xs text-[var(--dpf-text)] disabled:opacity-50"
    >
      {phase === "sending" ? "Sending…" : "Report to the project team"}
    </button>
  );
}
