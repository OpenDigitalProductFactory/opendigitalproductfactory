"use client";

import { useState, useRef, useEffect } from "react";
import { usePathname } from "next/navigation";
import { FeedbackForm } from "./FeedbackForm";
import {
  createManualFeedbackEventDetail,
  type FeedbackEventDetail,
} from "@/lib/feedback/feedback-event";
import { SHELL_TAP_TARGET_CLASS } from "@/lib/shell/shell-action-contract";

type Props = {
  userId?: string | null;
};

export function HeaderFeedbackButton({ userId }: Props) {
  const pathname = usePathname();
  const [showForm, setShowForm] = useState(false);
  const [detail, setDetail] = useState<FeedbackEventDetail | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function closeForm() {
    setShowForm(false);
    triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!showForm) return;
    dropdownRef.current?.querySelector<HTMLElement>('[role="dialog"] textarea, [role="dialog"] input, [role="dialog"] button')?.focus();
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowForm(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") closeForm();
    }
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [showForm]);

  function handleClick() {
    // A control labeled "Feedback" must open a feedback surface, not the AI
    // coworker conversation (BI-62FF22DB). Open the feedback form directly and
    // capture the current route as context.
    if (showForm) {
      setShowForm(false);
      return;
    }
    setDetail(createManualFeedbackEventDetail(pathname));
    setShowForm(true);
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleClick}
        aria-haspopup="dialog"
        aria-expanded={showForm}
        className={[
          SHELL_TAP_TARGET_CLASS,
          "rounded-full px-3 text-xs text-[var(--dpf-muted)] transition-colors",
          "hover:text-[var(--dpf-text)]",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--dpf-accent)]",
        ].join(" ")}
      >
        Feedback
      </button>

      {showForm && (
        <div
          role="dialog"
          aria-label="Send feedback"
          className="fixed inset-x-4 top-24 max-h-[calc(100dvh-8rem)] overflow-y-auto bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] rounded-lg shadow-lg z-50 lg:absolute lg:inset-x-auto lg:end-0 lg:top-full lg:mt-2 lg:w-72"
        >
          <div className="px-3 pt-2.5 text-xs font-semibold text-[var(--dpf-text)]">
            Send Feedback
          </div>
          <FeedbackForm
            routeContext={detail?.routeContext ?? pathname}
            {...(userId != null && { userId })}
            source="manual"
            {...(detail && {
              triggerKind: detail.triggerKind,
              supportSessionId: detail.supportSessionId,
              autoFilePolicy: detail.autoFilePolicy,
            })}
            onClose={closeForm}
          />
        </div>
      )}
    </div>
  );
}
