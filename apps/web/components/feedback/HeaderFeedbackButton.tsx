"use client";

import { useState, useRef, useEffect } from "react";
import { usePathname } from "next/navigation";
import { FeedbackForm } from "./FeedbackForm";
import {
  createManualFeedbackEventDetail,
  type FeedbackEventDetail,
} from "@/lib/feedback/feedback-event";

type Props = {
  userId?: string | null;
};

export function HeaderFeedbackButton({ userId }: Props) {
  const pathname = usePathname();
  const [showForm, setShowForm] = useState(false);
  const [detail, setDetail] = useState<FeedbackEventDetail | null>(null);
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
        type="button"
        onClick={handleClick}
        aria-haspopup="dialog"
        aria-expanded={showForm}
        className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] transition-colors"
      >
        Feedback
      </button>

      {showForm && (
        <div
          role="dialog"
          aria-label="Send feedback"
          className="absolute right-0 top-full mt-2 w-[300px] bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] rounded-lg shadow-lg z-50 overflow-hidden"
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
            onClose={() => setShowForm(false)}
          />
        </div>
      )}
    </div>
  );
}
