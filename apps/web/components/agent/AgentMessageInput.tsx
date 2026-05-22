"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { MAX_MESSAGE_LENGTH } from "@/lib/agent-coworker-types";
import {
  QUESTION_PACKET_EXPECTED_ARTIFACTS,
  type QuestionPacket,
  type QuestionPacketExpectedArtifact,
} from "@/lib/tak/question-packet";
import { AgentFileUpload } from "./AgentFileUpload";
import { MicButton } from "./MicButton";
import { useVoiceCapture } from "./hooks/useVoiceCapture";

type PendingFile = {
  attachmentId: string;
  fileName: string;
  parsedContent: unknown;
};

type Props = {
  onSend: (content: string, options?: { questionPacket?: QuestionPacket | null }) => void;
  disabled: boolean;
  busy?: boolean;
  threadId: string | null;
  pendingFile: PendingFile | null;
  onFileUploaded: (result: PendingFile) => void;
  onFileClear: () => void;
  /** Whether a ready voice profile is available for synthesis. */
  voiceSynthAvailable?: boolean;
  /** Current playback preference set by the user. */
  voicePlaybackEnabled?: boolean;
  /** Toggle handler — flips voicePlaybackEnabled and persists to localStorage. */
  onVoicePlaybackToggle?: () => void;
};

const EMPTY_EXPECTED_ARTIFACT = "";
type ExpectedArtifactValue = QuestionPacketExpectedArtifact | typeof EMPTY_EXPECTED_ARTIFACT;

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function AgentMessageInput({ onSend, disabled, busy, threadId, pendingFile, onFileUploaded, onFileClear, voiceSynthAvailable, voicePlaybackEnabled, onVoicePlaybackToggle }: Props) {
  const [value, setValue] = useState("");
  const [showQuestionContext, setShowQuestionContext] = useState(false);
  const [intentCenter, setIntentCenter] = useState("");
  const [sourceRefs, setSourceRefs] = useState("");
  const [hardEdges, setHardEdges] = useState("");
  const [expectedArtifact, setExpectedArtifact] = useState<ExpectedArtifactValue>(EMPTY_EXPECTED_ARTIFACT);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Voice input wiring (Slice 1 Task 10) ─────────────────────────────────
  // Splices the transcript into the textarea at the current cursor position
  // so users can review + edit before sending. We do NOT auto-send — the
  // transcript is treated like text the user typed.
  const insertTranscriptAtCursor = useCallback((text: string) => {
    if (!text) return;
    const el = textareaRef.current;
    setValue((current) => {
      const trimmed = text.trim();
      if (!el) return current ? `${current} ${trimmed}` : trimmed;
      const start = el.selectionStart ?? current.length;
      const end = el.selectionEnd ?? current.length;
      const before = current.slice(0, start);
      const after = current.slice(end);
      const sep = before && !before.endsWith(" ") ? " " : "";
      return `${before}${sep}${trimmed}${after}`;
    });
    // Refocus so the user can press Enter to send or edit further.
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  const voice = useVoiceCapture({
    threadId,
    onTranscript: insertTranscriptAtCursor,
    context: "coworker_panel",
  });

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  useEffect(() => {
    autoResize();
  }, [value, autoResize]);

  function handleSubmit() {
    const trimmed = value.trim();
    if (!trimmed || disabled || busy) return;
    if (trimmed.length > MAX_MESSAGE_LENGTH) return;
    const questionPacket = buildQuestionPacket();
    if (questionPacket) {
      onSend(trimmed, { questionPacket });
    } else {
      onSend(trimmed);
    }
    setValue("");
    setIntentCenter("");
    setSourceRefs("");
    setHardEdges("");
    setExpectedArtifact("");
    textareaRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
      return;
    }
    // Spacebar push-to-talk per spec §10 Q1: only when textarea is empty +
    // focused. Otherwise spacebar inserts a space normally.
    if (e.key === " " && value.length === 0 && voice.state === "idle" && voice.supported) {
      e.preventDefault();
      void voice.start();
      return;
    }
    // Escape cancels in-flight dictation per spec §5.1 ("hit Esc to stop").
    if (e.key === "Escape" && voice.state === "recording") {
      e.preventDefault();
      voice.stop();
      return;
    }
  }

  function buildQuestionPacket(): QuestionPacket | null {
    const packet: QuestionPacket = {};
    const trimmedIntent = intentCenter.trim();
    const sources = splitLines(sourceRefs);
    const edges = splitLines(hardEdges);

    if (trimmedIntent) {
      packet.intentCenter = trimmedIntent;
    }
    if (sources.length > 0) {
      packet.contextRefs = sources.map((ref, index) => ({
        kind: "freeform",
        label: `Source ${index + 1}`,
        ref,
      }));
    }
    if (edges.length > 0) {
      packet.hardEdges = edges;
    }
    if (expectedArtifact) {
      packet.expectedArtifact = expectedArtifact;
    }

    return Object.keys(packet).length > 0 ? packet : null;
  }

  const overLimit = value.trim().length > MAX_MESSAGE_LENGTH;

  return (
    <div style={{ borderTop: "1px solid var(--dpf-border)" }}>
      {/*
        Voice Slice 2 follow-up: surface voice errors INLINE, not just in the
        button tooltip. Operators were clicking the mic, getting silent
        failures (red ring on a small button), and concluding "nothing
        happened". The error banner shows the failure reason + the next
        actionable step in plain language.
      */}
      {voice.state === "error" && voice.error && (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            padding: "6px 12px",
            background: "rgba(211, 51, 51, 0.08)",
            borderBottom: "1px solid rgba(211, 51, 51, 0.25)",
            fontSize: 11,
            color: "var(--dpf-text)",
          }}
        >
          <span style={{ color: "var(--dpf-error, #d33)", fontWeight: 600 }}>
            Voice input failed
          </span>
          <span style={{ flex: 1, color: "var(--dpf-muted)" }}>
            {voice.error}
          </span>
          <button
            type="button"
            onClick={voice.reset}
            style={{
              background: "none",
              border: "none",
              color: "var(--dpf-accent)",
              cursor: "pointer",
              fontSize: 11,
              padding: 0,
            }}
          >
            Dismiss
          </button>
        </div>
      )}
      {pendingFile && (
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 12px 0",
        }}>
          <div style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            background: "var(--dpf-surface-2)",
            border: "1px solid var(--dpf-border)",
            borderRadius: 12,
            padding: "2px 8px 2px 6px",
            fontSize: 11,
            color: "var(--dpf-text)",
            maxWidth: "80%",
          }}>
            <span style={{ fontSize: 12 }}>{"\u{1F4CE}"}</span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {pendingFile.fileName}
            </span>
            <button
              type="button"
              onClick={onFileClear}
              style={{
                background: "none",
                border: "none",
                color: "var(--dpf-muted)",
                cursor: "pointer",
                fontSize: 13,
                lineHeight: 1,
                padding: "0 2px",
                marginLeft: 2,
              }}
              title="Remove file"
            >
              &times;
            </button>
          </div>
        </div>
      )}
      {showQuestionContext && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 8,
            padding: "8px 12px 0",
          }}
        >
          <label style={{ display: "grid", gap: 3, fontSize: 11, color: "var(--dpf-muted)" }}>
            Intent
            <input
              value={intentCenter}
              onChange={(e) => setIntentCenter(e.target.value)}
              placeholder="Center of attention"
              style={{
                background: "var(--dpf-surface-1)",
                border: "1px solid var(--dpf-border)",
                borderRadius: 6,
                color: "var(--dpf-text)",
                fontSize: 12,
                minHeight: 30,
                padding: "5px 8px",
              }}
            />
          </label>
          <label style={{ display: "grid", gap: 3, fontSize: 11, color: "var(--dpf-muted)" }}>
            Sources
            <textarea
              value={sourceRefs}
              onChange={(e) => setSourceRefs(e.target.value)}
              placeholder="One source per line"
              rows={2}
              style={{
                background: "var(--dpf-surface-1)",
                border: "1px solid var(--dpf-border)",
                borderRadius: 6,
                color: "var(--dpf-text)",
                fontSize: 12,
                minHeight: 48,
                padding: "5px 8px",
                resize: "vertical",
              }}
            />
          </label>
          <label style={{ display: "grid", gap: 3, fontSize: 11, color: "var(--dpf-muted)" }}>
            Exclusions
            <textarea
              value={hardEdges}
              onChange={(e) => setHardEdges(e.target.value)}
              placeholder="One hard edge per line"
              rows={2}
              style={{
                background: "var(--dpf-surface-1)",
                border: "1px solid var(--dpf-border)",
                borderRadius: 6,
                color: "var(--dpf-text)",
                fontSize: 12,
                minHeight: 48,
                padding: "5px 8px",
                resize: "vertical",
              }}
            />
          </label>
          <label style={{ display: "grid", gap: 3, fontSize: 11, color: "var(--dpf-muted)" }}>
            Artifact
            <select
              value={expectedArtifact}
              onChange={(e) => setExpectedArtifact(e.target.value as ExpectedArtifactValue)}
              style={{
                background: "var(--dpf-surface-1)",
                border: "1px solid var(--dpf-border)",
                borderRadius: 6,
                color: "var(--dpf-text)",
                fontSize: 12,
                minHeight: 30,
                padding: "5px 8px",
              }}
            >
              <option value="" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
                Unspecified
              </option>
              {QUESTION_PACKET_EXPECTED_ARTIFACTS.map((artifact) => (
                <option
                  key={artifact}
                  value={artifact}
                  className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]"
                >
                  {artifact.replace(/-/g, " ")}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <div style={{
        display: "flex",
        gap: 6,
        padding: "10px 12px",
        alignItems: "flex-end",
      }}>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={disabled ? "Sending..." : busy ? "Agent is working... type your next message" : "Ask your co-worker..."}
          rows={1}
          style={{
            flex: 1,
            background: "color-mix(in srgb, var(--dpf-bg) 80%, transparent)",
            border: `1px solid ${overLimit ? "var(--dpf-error)" : "var(--dpf-border)"}`,
            borderRadius: 6,
            padding: "6px 10px",
            fontSize: 12,
            color: "var(--dpf-text)",
            outline: "none",
            resize: "none",
            overflow: "auto",
            lineHeight: "1.4",
            minHeight: 32,
            maxHeight: 160,
          }}
        />
        {overLimit && (
          <span style={{ fontSize: 10, color: "var(--dpf-error)", flexShrink: 0, alignSelf: "center" }}>
            {value.trim().length.toLocaleString()}/{MAX_MESSAGE_LENGTH.toLocaleString()}
          </span>
        )}
        <button
          type="button"
          onClick={() => setShowQuestionContext((current) => !current)}
          aria-expanded={showQuestionContext}
          style={{
            background: "var(--dpf-surface-2)",
            border: "1px solid var(--dpf-border)",
            borderRadius: 6,
            color: "var(--dpf-text)",
            cursor: disabled || busy ? "not-allowed" : "pointer",
            flexShrink: 0,
            fontSize: 12,
            height: 32,
            opacity: disabled || busy ? 0.5 : 1,
            padding: "0 8px",
          }}
          disabled={disabled || !!busy}
        >
          {showQuestionContext ? "Hide context" : "Add context"}
        </button>
        <MicButton
          state={voice.state}
          errorMessage={voice.error}
          errorCode={voice.errorCode}
          supported={voice.supported}
          onStart={() => void voice.start()}
          onStop={voice.stop}
          onReset={voice.reset}
          disabled={disabled || !!busy}
        />
        {voiceSynthAvailable && onVoicePlaybackToggle && (
          <button
            type="button"
            onClick={onVoicePlaybackToggle}
            title={voicePlaybackEnabled ? "Mute voice playback" : "Unmute voice playback"}
            aria-label={voicePlaybackEnabled ? "Mute voice playback" : "Unmute voice playback"}
            aria-pressed={voicePlaybackEnabled}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: voicePlaybackEnabled ? "var(--dpf-accent)" : "var(--dpf-muted)",
              fontSize: 16,
              lineHeight: 1,
              padding: "0 2px",
              flexShrink: 0,
              height: 32,
              display: "flex",
              alignItems: "center",
              opacity: voicePlaybackEnabled ? 1 : 0.5,
              transition: "color 0.15s, opacity 0.15s",
            }}
          >
            {voicePlaybackEnabled ? "🔊" : "🔇"}
          </button>
        )}
        <AgentFileUpload
          threadId={threadId}
          disabled={disabled || !!busy}
          onUploaded={onFileUploaded}
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={disabled || busy || !value.trim() || overLimit}
          title={busy ? "Agent is still working" : undefined}
          style={{
            background: "var(--dpf-accent)",
            border: "none",
            borderRadius: 6,
            padding: "6px 12px",
            fontSize: 12,
            color: "#ffffff",
            cursor: disabled || busy || !value.trim() || overLimit ? "not-allowed" : "pointer",
            opacity: disabled || busy || !value.trim() || overLimit ? 0.5 : 1,
            flexShrink: 0,
            height: 32,
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
