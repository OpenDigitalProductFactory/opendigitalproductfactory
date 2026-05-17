"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { MAX_MESSAGE_LENGTH } from "@/lib/agent-coworker-types";
import { AgentFileUpload } from "./AgentFileUpload";
import { MicButton } from "./MicButton";
import { useVoiceCapture } from "./hooks/useVoiceCapture";

type PendingFile = {
  attachmentId: string;
  fileName: string;
  parsedContent: unknown;
};

type Props = {
  onSend: (content: string) => void;
  disabled: boolean;
  busy?: boolean;
  threadId: string | null;
  pendingFile: PendingFile | null;
  onFileUploaded: (result: PendingFile) => void;
  onFileClear: () => void;
};

export function AgentMessageInput({ onSend, disabled, busy, threadId, pendingFile, onFileUploaded, onFileClear }: Props) {
  const [value, setValue] = useState("");
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
    onSend(trimmed);
    setValue("");
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

  const overLimit = value.trim().length > MAX_MESSAGE_LENGTH;

  return (
    <div style={{ borderTop: "1px solid var(--dpf-border)" }}>
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
