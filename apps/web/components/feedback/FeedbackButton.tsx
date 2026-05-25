"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { FeedbackForm } from "./FeedbackForm";

type Props = {
  userId?: string | null;
};

export function FeedbackButton({ userId }: Props) {
  const pathname = usePathname();
  const [showForm, setShowForm] = useState(false);

  function handleClick() {
    const event = new CustomEvent("open-agent-feedback");
    document.dispatchEvent(event);

    setTimeout(() => {
      const panel = document.querySelector("[data-agent-panel]");
      if (!panel) {
        setShowForm(true);
      }
    }, 500);
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        title="Send feedback"
        className="fixed bottom-[60px] left-4 z-[49] flex items-center gap-1.5 rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]/70 px-3.5 py-1.5 text-[11px] font-normal text-[var(--dpf-muted)] shadow-md backdrop-blur-sm transition-colors hover:text-[var(--dpf-text)]"
      >
        Feedback
      </button>

      {showForm && (
        <div
          className="fixed bottom-[100px] left-4 z-50 w-[300px] overflow-hidden rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] shadow-xl backdrop-blur"
        >
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
    </>
  );
}
