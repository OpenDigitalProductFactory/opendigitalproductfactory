// apps/web/components/build/SandboxPreview.tsx
"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { type BuildPhase } from "@/lib/feature-build-types";

type Props = {
  buildId: string;
  phase: BuildPhase;
  sandboxPort: number | null;
};

/** Paths that must not be accessible inside the sandbox preview. */
const BLOCKED_PATHS = ["/build", "/platform"];

export function SandboxPreview({ buildId, phase, sandboxPort }: Props) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [currentPath, setCurrentPath] = useState("/");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const isRunning = sandboxPort !== null && (phase === "build" || phase === "review" || phase === "ship");

  const handleRefresh = useCallback(() => {
    setIframeLoaded(false);
    setRefreshKey(k => k + 1);
    setCurrentPath("/");
  }, []);

  // Track iframe navigation and extract the sandbox path from proxy URLs
  const handleIframeLoad = useCallback(() => {
    setIframeLoaded(true);
    try {
      const win = iframeRef.current?.contentWindow;
      if (!win) return;
      const fullPath = win.location.pathname;

      // Extract sandbox path from proxy URL query param
      let displayPath: string;
      if (fullPath.startsWith("/api/sandbox/preview")) {
        const params = new URLSearchParams(win.location.search);
        displayPath = params.get("path") ?? "/";
      } else {
        displayPath = fullPath;
      }
      setCurrentPath(displayPath);
    } catch {
      // Cross-origin or security restriction — ignore
    }
  }, []);

  // Poll for path changes from in-iframe navigation (clicks, form submits).
  // The injected nav script routes clicks through the proxy, but this catches
  // any escapes (client-side routing, direct URL changes) and updates the address bar.
  useEffect(() => {
    if (!iframeLoaded || !iframeRef.current) return;
    const proxyPrefix = "/api/sandbox/preview";
    const interval = setInterval(() => {
      try {
        const win = iframeRef.current?.contentWindow;
        if (!win) return;
        const fullPath = win.location.pathname;
        const search = win.location.search;

        // If iframe is on a proxy URL, extract the sandbox path from ?path=
        let displayPath: string;
        if (fullPath.startsWith(proxyPrefix)) {
          const params = new URLSearchParams(search);
          displayPath = params.get("path") ?? "/";
        } else {
          // Iframe escaped the proxy — redirect it back through the proxy
          displayPath = fullPath;
          if (BLOCKED_PATHS.some(bp => fullPath.startsWith(bp))) {
            displayPath = "/";
          }
          const proxyUrl = `${proxyPrefix}?buildId=${encodeURIComponent(buildId)}&path=${encodeURIComponent(displayPath)}`;
          win.location.replace(proxyUrl);
        }

        if (displayPath !== currentPath) {
          setCurrentPath(displayPath);
        }
      } catch {
        // Cross-origin — ignore
      }
    }, 500);
    return () => clearInterval(interval);
  }, [iframeLoaded, currentPath, buildId]);

  if (!isRunning) {
    return (
      <div className="flex-1 grid place-items-center bg-[var(--dpf-surface-2)] rounded-lg border border-[var(--dpf-border)]">
        <div className="text-center p-8">
          <div className="text-[32px] mb-3 opacity-30">&#9881;</div>
          <p className="text-sm text-[var(--dpf-muted)] leading-relaxed">
            {phase === "ideate" || phase === "plan"
              ? "Sandbox preview will appear here once the Build phase starts."
              : phase === "complete"
              ? "Feature has been shipped."
              : "Sandbox is not running."}
          </p>
        </div>
      </div>
    );
  }

  const previewUrl = `/api/sandbox/preview?buildId=${encodeURIComponent(buildId)}&path=/&_t=${refreshKey}`;

  return (
    <div className="flex-1 flex flex-col rounded-lg border border-[var(--dpf-border)] overflow-hidden shadow-dpf-sm">
      {/* Header: Sandbox label + address bar + controls */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--dpf-surface-2)] border-b border-[var(--dpf-border)] text-xs">
        <span className="w-2 h-2 rounded-full bg-[var(--dpf-success)] flex-shrink-0" />
        <span className="font-medium text-[var(--dpf-text)] flex-shrink-0">Sandbox</span>
        {/* Address bar */}
        <div
          className="flex-1 px-2 py-0.5 rounded bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] text-[var(--dpf-muted)] font-mono truncate min-w-0"
          title={currentPath}
        >
          {currentPath}
        </div>
        <button
          onClick={handleRefresh}
          className="flex-shrink-0 px-2 py-0.5 rounded text-[10px] border border-[var(--dpf-border)] hover:border-[var(--dpf-accent)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] transition-colors"
          title="Refresh sandbox preview"
          aria-label="Refresh sandbox preview"
        >
          &#8635; Refresh
        </button>
      </div>
      <div className="flex-1 relative min-h-[400px]">
        {!iframeLoaded && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[var(--dpf-surface-2)] animate-fade-in">
            <div className="w-6 h-6 border-2 border-[var(--dpf-accent)] border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-[var(--dpf-muted)]">Loading sandbox...</span>
          </div>
        )}
        <iframe
          ref={iframeRef}
          key={refreshKey}
          src={previewUrl}
          title="Sandbox Preview"
          className="w-full h-full border-none"
          style={{ background: "var(--dpf-surface-1)" }}
          onLoad={handleIframeLoad}
        />
      </div>
    </div>
  );
}
