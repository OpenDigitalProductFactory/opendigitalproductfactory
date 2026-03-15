"use client";

import { useEffect, useRef } from "react";

/**
 * Fires a tiny inference call on mount to warm up the local AI model.
 * Shows a status banner while the model is loading into memory.
 * Runs once per page load — subsequent calls are fast because keep_alive=-1 keeps the model loaded.
 */
export function ModelWarmup() {
  const warmedUp = useRef(false);

  useEffect(() => {
    if (warmedUp.current) return;
    warmedUp.current = true;

    async function warmup() {
      // Show banner
      document.dispatchEvent(new CustomEvent("status-banner", {
        detail: { id: "model-warmup", text: "Loading AI model into memory... first response may take a moment.", type: "info" },
      }));

      try {
        const start = Date.now();
        const res = await fetch("/api/quality/report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "system_warmup",
            title: "Model warmup ping",
            source: "warmup",
          }),
        });

        // Also ping the AI to force model load — use a tiny message
        await fetch("/api/mcp/call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "report_quality_issue",
            arguments: { type: "feedback", title: "System warmup check", description: "Automated warmup — ignore this." },
          }),
        }).catch(() => {});

        const elapsed = Date.now() - start;

        // Dismiss the loading banner
        document.dispatchEvent(new CustomEvent("status-banner-dismiss", { detail: "model-warmup" }));

        // If it took more than 5 seconds, the model was cold-loading
        if (elapsed > 5000) {
          document.dispatchEvent(new CustomEvent("status-banner", {
            detail: { id: "model-ready", text: "AI model loaded and ready.", type: "success" },
          }));
          // Auto-dismiss after 5 seconds
          setTimeout(() => {
            document.dispatchEvent(new CustomEvent("status-banner-dismiss", { detail: "model-ready" }));
          }, 5000);
        } else {
          // Model was already loaded — no banner needed
        }
      } catch {
        document.dispatchEvent(new CustomEvent("status-banner-dismiss", { detail: "model-warmup" }));
      }
    }

    // Delay warmup slightly so the page renders first
    const timer = setTimeout(warmup, 2000);
    return () => clearTimeout(timer);
  }, []);

  return null;
}
