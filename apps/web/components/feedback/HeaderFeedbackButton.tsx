"use client";

import { useState, useRef, useEffect } from "react";
import { usePathname } from "next/navigation";
import { FeedbackForm } from "./FeedbackForm";

type Props = {
  userId?: string | null;
};

export function HeaderFeedbackButton({ userId }: Props) {
  const pathname = usePathname();
  const [showForm, setShowForm] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showForm) return;
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowForm(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showForm]);

  function handleClick() {
    // Try to open AI co-worker with feedback prompt
    const event = new CustomEvent("open-agent-feedback");
    document.dispatchEvent(event);

    // Fallback: if panel doesn't open, show the simple form
    setTimeout(() => {
      const panel = document.querySelector("[data-agent-panel]");
      if (!panel) {
        setShowForm(true);
      }
    }, 500);
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={handleClick}
        className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] transition-colors"
      >
        Feedback
      </button>

      {showForm && (
        <div className="absolute right-0 top-full mt-2 w-[300px] bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] rounded-lg shadow-lg z-50 overflow-hidden">
          <div className="px-3 pt-2.5 text-xs font-semibold text-[var(--dpf-text)]">
            Send Feedback
          </div>
          <FeedbackForm
            routeContext={pathname}
            {...(userId != null && { userId })}
            source="manual"
            onClose={() => setShowForm(false)}
          />
        </div>
      )}
    </div>
  );
}
