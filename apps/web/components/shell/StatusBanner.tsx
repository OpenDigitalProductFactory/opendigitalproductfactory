"use client";

import { useEffect, useState } from "react";

type BannerMessage = {
  id: string;
  text: string;
  type: "info" | "warning" | "success";
};

const BANNER_COLORS = {
  info: { bg: "color-mix(in srgb, var(--dpf-accent) 15%, transparent)", border: "color-mix(in srgb, var(--dpf-accent) 30%, transparent)", text: "var(--dpf-accent)" },
  warning: { bg: "color-mix(in srgb, var(--dpf-warning) 15%, transparent)", border: "color-mix(in srgb, var(--dpf-warning) 30%, transparent)", text: "var(--dpf-warning)" },
  success: { bg: "color-mix(in srgb, var(--dpf-success) 15%, transparent)", border: "color-mix(in srgb, var(--dpf-success) 30%, transparent)", text: "var(--dpf-success)" },
};

export function StatusBanner() {
  const [messages, setMessages] = useState<BannerMessage[]>([]);

  useEffect(() => {
    // Listen for banner messages from anywhere in the app
    function handleBanner(e: Event) {
      const detail = (e as CustomEvent).detail as BannerMessage;
      if (detail?.id && detail?.text) {
        setMessages((prev) => {
          // Replace if same id, otherwise add
          const filtered = prev.filter((m) => m.id !== detail.id);
          return [...filtered, detail];
        });
      }
    }

    function handleDismiss(e: Event) {
      const id = (e as CustomEvent).detail as string;
      if (id) setMessages((prev) => prev.filter((m) => m.id !== id));
    }

    document.addEventListener("status-banner", handleBanner);
    document.addEventListener("status-banner-dismiss", handleDismiss);
    return () => {
      document.removeEventListener("status-banner", handleBanner);
      document.removeEventListener("status-banner-dismiss", handleDismiss);
    };
  }, []);

  if (messages.length === 0) return null;

  return (
    <div style={{ width: "100%" }}>
      {messages.map((msg) => {
        const colors = BANNER_COLORS[msg.type];
        return (
          <div
            key={msg.id}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "6px 16px",
              background: colors.bg,
              borderBottom: `1px solid ${colors.border}`,
              fontSize: 12,
              color: colors.text,
            }}
          >
            <span>{msg.text}</span>
            <button
              type="button"
              onClick={() => setMessages((prev) => prev.filter((m) => m.id !== msg.id))}
              style={{ background: "none", border: "none", color: colors.text, cursor: "pointer", fontSize: 14, padding: "0 4px", opacity: 0.7 }}
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
