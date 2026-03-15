"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { MAX_MESSAGE_LENGTH } from "@/lib/agent-coworker-types";
import { AgentFileUpload } from "./AgentFileUpload";

type PendingFile = {
  attachmentId: string;
  fileName: string;
  parsedContent: unknown;
};

type Props = {
  onSend: (content: string) => void;
  disabled: boolean;
  threadId: string | null;
  pendingFile: PendingFile | null;
  onFileUploaded: (result: PendingFile) => void;
  onFileClear: () => void;
};

export function AgentMessageInput({ onSend, disabled, threadId, pendingFile, onFileUploaded, onFileClear }: Props) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
    if (!trimmed || disabled) return;
    if (trimmed.length > MAX_MESSAGE_LENGTH) return;
    onSend(trimmed);
    setValue("");
    textareaRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  const overLimit = value.trim().length > MAX_MESSAGE_LENGTH;

  return (
    <div style={{ borderTop: "1px solid rgba(42, 42, 64, 0.6)" }}>
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
            color: "#e0e0ff",
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
          placeholder={disabled ? "Sending..." : "Ask your co-worker..."}
          rows={1}
          style={{
            flex: 1,
            background: "rgba(15, 15, 26, 0.8)",
            border: `1px solid ${overLimit ? "#ef4444" : "rgba(42, 42, 64, 0.6)"}`,
            borderRadius: 6,
            padding: "6px 10px",
            fontSize: 12,
            color: "#e0e0ff",
            outline: "none",
            resize: "none",
            overflow: "auto",
            lineHeight: "1.4",
            minHeight: 32,
            maxHeight: 160,
          }}
        />
        <AgentFileUpload
          threadId={threadId}
          disabled={disabled}
          onUploaded={onFileUploaded}
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={disabled || !value.trim() || overLimit}
          style={{
            background: "var(--dpf-accent)",
            border: "none",
            borderRadius: 6,
            padding: "6px 12px",
            fontSize: 12,
            color: "#ffffff",
            cursor: disabled || !value.trim() || overLimit ? "not-allowed" : "pointer",
            opacity: disabled || !value.trim() || overLimit ? 0.5 : 1,
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
