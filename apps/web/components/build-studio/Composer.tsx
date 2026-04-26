"use client";
import { Send, Pause, Sparkles } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

interface Props {
  onSend: (text: string) => void;
  onPause: () => void;
  onSuggest: () => void;
}

export function Composer({ onSend, onPause, onSuggest }: Props) {
  const [value, setValue] = useState("");
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const trimmed = value.trim();
  const canSend = trimmed.length > 0;

  const submit = useCallback(() => {
    if (!canSend) return;
    onSend(trimmed);
    setValue("");
    if (taRef.current) {
      taRef.current.style.height = "";
    }
  }, [canSend, trimmed, onSend]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  };

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  return (
    <div className="border-t border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-[22px] py-3">
      <textarea
        ref={taRef}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        rows={2}
        placeholder="Reply to DPF, or shape what to build next…"
        className="w-full resize-none bg-transparent border border-[var(--dpf-border)] rounded-xl px-3 py-2 text-[13.5px] text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] focus:outline-none focus:border-[var(--dpf-accent)] transition-colors"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={onSuggest}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium rounded-lg text-[var(--dpf-text-secondary)] hover:bg-[var(--dpf-surface-2)] transition-colors"
        >
          <Sparkles size={12} />
          Suggest a change
        </button>
        <button
          type="button"
          onClick={onPause}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium rounded-lg text-[var(--dpf-text-secondary)] hover:bg-[var(--dpf-surface-2)] transition-colors"
        >
          <Pause size={12} />
          Pause build
        </button>
        <span className="flex-1" />
        <button
          type="button"
          aria-label="Send"
          onClick={submit}
          disabled={!canSend}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-semibold rounded-lg bg-[var(--dpf-accent)] text-[var(--dpf-bg)] hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send size={12} />
          Send
        </button>
      </div>
    </div>
  );
}
