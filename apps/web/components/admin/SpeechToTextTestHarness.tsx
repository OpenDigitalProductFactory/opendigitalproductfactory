"use client";

/**
 * Voice Input Slice 1 / Task 11 — admin test-phrase harness (client component).
 *
 * Owning plan: docs/superpowers/plans/2026-05-16-voice-input-slice-1-portal-mic.md
 * Owning spec: docs/superpowers/specs/2026-05-16-voice-input-and-transcription-design.md §5.3
 *
 * Sub-component of <SpeechToTextCard>. Exercises the full pipeline:
 *   user clicks → mic capture → POST /api/transcribe (context="test_harness")
 *   → transcript displayed inline.
 *
 * Reuses the same useVoiceCapture hook the AI Coworker panel mic uses, so
 * "test phrase succeeded" is meaningful evidence: it proves permission,
 * capture, server route, routing layer, and sidecar all work end-to-end.
 */

import { useState } from "react";
import { MicButton } from "@/components/agent/MicButton";
import { useVoiceCapture } from "@/components/agent/hooks/useVoiceCapture";

export interface SpeechToTextTestHarnessProps {
  /** Whether the readiness check showed a healthy endpoint. Used to disable
   *  the harness up-front so admins don't waste a permission prompt when
   *  the sidecar isn't running. */
  readinessIsHealthy: boolean;
}

export function SpeechToTextTestHarness({ readinessIsHealthy }: SpeechToTextTestHarnessProps) {
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);
  const [lastTestedAt, setLastTestedAt] = useState<string | null>(null);

  const voice = useVoiceCapture({
    onTranscript: (text) => {
      setLastTranscript(text);
      setLastTestedAt(new Date().toISOString());
    },
    context: "test_harness",
  });

  return (
    <div
      role="region"
      aria-label="Speech-to-text test harness"
      className="mt-3 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-[var(--dpf-text)]">Test phrase</p>
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">
            Click the mic, speak a short phrase, then stop. The transcript should appear below.
          </p>
        </div>
        <MicButton
          state={voice.state}
          errorMessage={voice.error}
          errorCode={voice.errorCode}
          supported={voice.supported && readinessIsHealthy}
          onStart={() => void voice.start()}
          onStop={voice.stop}
          onReset={voice.reset}
        />
      </div>

      {voice.state === "error" && voice.error && (
        <p
          role="alert"
          className="mt-3 rounded border border-[var(--dpf-error,#d33)] bg-[color-mix(in_srgb,var(--dpf-error,#d33)_8%,transparent)] p-2 text-xs text-[var(--dpf-text)]"
        >
          {voice.error}
        </p>
      )}

      {lastTranscript !== null && (
        <div
          data-testid="stt-test-result"
          className="mt-3 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-2"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--dpf-muted)]">
            Last test result
          </p>
          <p className="mt-1 text-sm text-[var(--dpf-text)]">
            {lastTranscript.length > 0 ? `"${lastTranscript}"` : "(empty transcript — try speaking a clearer phrase)"}
          </p>
          {lastTestedAt && (
            <p className="mt-1 text-xs text-[var(--dpf-muted)]">
              Tested {new Date(lastTestedAt).toLocaleString()}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
