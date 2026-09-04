"use client";

/**
 * Voice Input Slice 1 / Task 9 — MicButton component.
 *
 * Owning plan: docs/superpowers/plans/2026-05-16-voice-input-slice-1-portal-mic.md
 * Owning spec: docs/superpowers/specs/2026-05-16-voice-input-and-transcription-design.md §5.1
 *
 * State machine (rendered states):
 *   - idle           → Mic icon, "Start dictation" tooltip, clickable
 *   - recording      → MicOff icon + red pulsing dot, "Stop dictation"
 *   - transcribing   → Spinner, "Transcribing…", disabled
 *   - error          → Mic icon with red ring, click to retry (calls reset)
 *   - unconfigured   → MicOff icon, disabled, "Speech-to-text not configured" tooltip
 *
 * Per Task 13 Step 6 + plan advisory: when STT is not configured (the hook's
 * `supported` flag is false, or no transcription endpoint is seeded), the
 * button is RENDERED-but-DISABLED with a tooltip explaining how to enable it.
 * Hidden buttons are worse UX (admins wonder where the mic went); disabled
 * with a discoverable tooltip is the chosen behaviour.
 */

import { Mic, MicOff, Loader2 } from "lucide-react";
import type { VoiceCaptureState, VoiceCaptureErrorCode } from "./hooks/useVoiceCapture";

export interface MicButtonProps {
  /** Current state from useVoiceCapture(). */
  state: VoiceCaptureState;
  /** Error message from useVoiceCapture(), shown via tooltip when state==="error". */
  errorMessage?: string | null;
  /** Error code from useVoiceCapture(). */
  errorCode?: VoiceCaptureErrorCode | null;
  /**
   * Whether the platform supports voice capture at all (from
   * `useVoiceCapture().supported`). When false, the button renders DISABLED
   * with the "not configured" tooltip per Task 13 Step 6 decision.
   */
  supported: boolean;
  /** Called on click in idle state. */
  onStart: () => void;
  /** Called on click in recording state. */
  onStop: () => void;
  /** Called on click in error state (returns to idle so user can retry). */
  onReset: () => void;
  /**
   * Globally disable the button (e.g. while the agent is busy sending a
   * message). Overrides everything — button is unclickable.
   */
  disabled?: boolean;
}

const BUTTON_SIZE = 32;

function recordingDotKeyframes(): string {
  // Inline keyframes for the pulsing red privacy dot (spec §5.1).
  // Pure CSS — avoids a global stylesheet dependency.
  return `
    @keyframes dpf-voice-pulse {
      0%   { opacity: 1;   transform: scale(1); }
      50%  { opacity: 0.5; transform: scale(0.85); }
      100% { opacity: 1;   transform: scale(1); }
    }
  `;
}

export function MicButton(props: MicButtonProps) {
  const { state, errorMessage, errorCode, supported, onStart, onStop, onReset, disabled = false } = props;

  // ── Derive effective state for rendering ─────────────────────────────────
  const isUnconfigured = !supported;
  const isRecording = state === "recording" || state === "permission_check";
  const isTranscribing = state === "transcribing";
  const isError = state === "error";
  const isIdle = state === "idle" || state === "result";

  // ── Click handler routes by state ────────────────────────────────────────
  function handleClick() {
    if (disabled || isUnconfigured) return;
    if (isRecording) {
      onStop();
      return;
    }
    if (isError) {
      onReset();
      return;
    }
    if (isTranscribing) {
      return; // ignore clicks while in-flight
    }
    onStart();
  }

  // ── Choose icon + ariaLabel + tooltip ────────────────────────────────────
  let icon: React.ReactElement;
  let ariaLabel: string;
  let title: string;
  let dataState: string;
  let iconColor = "var(--dpf-muted)";
  let borderColor = "var(--dpf-border)";

  if (isUnconfigured) {
    icon = <MicOff size={16} />;
    ariaLabel = "Voice input not configured";
    title = "Speech-to-text not configured — see Platform Tools > Communications";
    dataState = "unconfigured";
  } else if (isTranscribing) {
    icon = <Loader2 size={16} className="dpf-voice-spin" />;
    ariaLabel = "Transcribing audio";
    title = "Transcribing…";
    dataState = "transcribing";
  } else if (isRecording) {
    icon = <MicOff size={16} />;
    ariaLabel = "Stop dictation";
    title = "Click to stop dictation";
    dataState = "recording";
    iconColor = "var(--dpf-error)";
    borderColor = "var(--dpf-error)";
  } else if (isError) {
    icon = <Mic size={16} />;
    ariaLabel = "Voice input error — click to retry";
    title = errorMessage ?? "Voice input failed. Click to retry.";
    dataState = "error";
    iconColor = "var(--dpf-error)";
    borderColor = "var(--dpf-error)";
  } else {
    // idle / result
    icon = <Mic size={16} />;
    ariaLabel = "Start dictation";
    title = "Hold to speak, or click to start dictating";
    dataState = "idle";
  }

  const effectivelyDisabled = disabled || isUnconfigured || isTranscribing;

  return (
    <>
      {/* Style block — needed for the pulsing dot + spinner animation.
          Inline keeps the component self-contained without a global stylesheet. */}
      <style>{`${recordingDotKeyframes()}
        .dpf-voice-spin { animation: dpf-voice-spin 1s linear infinite; }
        @keyframes dpf-voice-spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
      `}</style>
      <button
        type="button"
        onClick={handleClick}
        disabled={effectivelyDisabled}
        aria-label={ariaLabel}
        aria-pressed={isRecording}
        title={title}
        data-voice-state={dataState}
        data-voice-error-code={errorCode ?? undefined}
        style={{
          position: "relative",
          background: isRecording
            ? "color-mix(in srgb, var(--dpf-error) 15%, transparent)"
            : "var(--dpf-surface-2)",
          border: `1px solid ${borderColor}`,
          borderRadius: 6,
          padding: "0 8px",
          height: BUTTON_SIZE,
          minWidth: BUTTON_SIZE,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: iconColor,
          cursor: effectivelyDisabled ? "not-allowed" : "pointer",
          opacity: effectivelyDisabled ? 0.5 : 1,
          flexShrink: 0,
        }}
      >
        {icon}
        {isRecording && (
          <span
            data-testid="voice-recording-dot"
            aria-hidden="true"
            style={{
              position: "absolute",
              top: 3,
              right: 3,
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--dpf-error)",
              animation: "dpf-voice-pulse 1.2s ease-in-out infinite",
            }}
          />
        )}
      </button>
    </>
  );
}
