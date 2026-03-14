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
    // Try to open AI co-worker with feedback prompt
    const event = new CustomEvent("open-agent-feedback");
    document.dispatchEvent(event);

    // Fallback: if panel doesn't open (no listener, not hydrated, no provider),
    // show the simple form after a short delay
    setTimeout(() => {
      // Check if co-worker panel opened by looking for it in the DOM
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
        style={{
          position: "fixed",
          left: 16,
          bottom: 60,
          padding: "6px 14px",
          borderRadius: 16,
          background: "rgba(136, 136, 160, 0.4)",
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
          border: "1px solid rgba(136, 136, 160, 0.25)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 5,
          boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
          zIndex: 49,
          color: "rgba(224, 224, 255, 0.8)",
          fontSize: 11,
          fontWeight: 400,
        }}
      >
        Feedback
      </button>

      {showForm && (
        <div style={{
          position: "fixed",
          left: 16,
          bottom: 100,
          width: 300,
          background: "rgba(26, 26, 46, 0.9)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          border: "1px solid rgba(42, 42, 64, 0.6)",
          borderRadius: 12,
          boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          zIndex: 50,
          overflow: "hidden",
        }}>
          <div style={{ padding: "10px 12px 0", fontSize: 12, fontWeight: 600, color: "#e0e0ff" }}>
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
