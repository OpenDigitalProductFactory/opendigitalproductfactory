"use client";

// Platform form-kit — auto-growing text editor (EP-UX-SYSTEM, BI-C167C45E).
// Spec: docs/superpowers/specs/2026-07-28-platform-forms-framework-design.md
//
// A textarea that starts one line tall and grows with its content (clamped by
// max-height), so free text in a form behaves like an input for short values
// and like a document for long ones — never a truncated single line.

import { useLayoutEffect, useRef } from "react";

export interface AutoGrowTextareaProps {
  value: string;
  onValueChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  className?: string;
}

export function AutoGrowTextarea({
  value,
  onValueChange,
  ariaLabel,
  placeholder,
  className,
}: AutoGrowTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Fit height to content on every value change (max-height + overflow come
  // from the className, so very long content scrolls instead of growing forever).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
      aria-label={ariaLabel}
      placeholder={placeholder}
      className={
        className ??
        "w-full resize-none overflow-y-auto max-h-64 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1 text-sm text-[var(--dpf-text)]"
      }
    />
  );
}
