"use client";

import { useState, useRef } from "react";
import { MAX_MESSAGE_LENGTH } from "@/lib/agent-coworker-types";

type Props = {
  onSend: (content: string) => void;
  disabled: boolean;
};

export function AgentMessageInput({ onSend, disabled }: Props) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function handleSubmit() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    if (trimmed.length > MAX_MESSAGE_LENGTH) return;
    onSend(trimmed);
    setValue("");
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  const overLimit = value.trim().length > MAX_MESSAGE_LENGTH;

  return (
    <div style={{
      display: "flex",
      gap: 6,
      padding: "10px 12px",
      borderTop: "1px solid rgba(42, 42, 64, 0.6)",
    }}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={disabled ? "Sending..." : "Ask your co-worker..."}
        style={{
          flex: 1,
          background: "rgba(15, 15, 26, 0.8)",
          border: `1px solid ${overLimit ? "#ef4444" : "rgba(42, 42, 64, 0.6)"}`,
          borderRadius: 6,
          padding: "6px 10px",
          fontSize: 12,
          color: "#e0e0ff",
          outline: "none",
        }}
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
        }}
      >
        Send
      </button>
    </div>
  );
}
