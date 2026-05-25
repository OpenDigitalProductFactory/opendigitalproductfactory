"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

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
    <div
      className="pointer-events-auto w-[min(960px,calc(100vw-24px))] space-y-2"
      data-overlay-banner="true"
    >
      {messages.map((msg) => {
        const colors = BANNER_COLORS[msg.type];
        return (
          <div
            key={msg.id}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "8px 12px",
              background: colors.bg,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              boxShadow: "0 10px 30px color-mix(in srgb, var(--dpf-text) 14%, transparent)",
              fontSize: 12,
              color: colors.text,
            }}
          >
            <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{msg.text}</span>
            <button
              type="button"
              aria-label="Dismiss status banner"
              onClick={() => setMessages((prev) => prev.filter((m) => m.id !== msg.id))}
              style={{
                background: "transparent",
                border: "none",
                color: colors.text,
                cursor: "pointer",
                padding: 4,
                opacity: 0.8,
              }}
            >
              <X aria-hidden="true" size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
