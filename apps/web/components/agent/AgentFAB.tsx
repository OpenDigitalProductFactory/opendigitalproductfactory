"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  onClick: () => void;
};

const LS_KEY_FAB_Y = "agent-fab-y-pct";
const DEFAULT_FAB_Y_PERCENT = 82;
const MIN_FAB_Y_PERCENT = 72;
const MAX_FAB_Y_PERCENT = 92;

function clampYPercent(pct: number): number {
  return Math.max(MIN_FAB_Y_PERCENT, Math.min(MAX_FAB_Y_PERCENT, pct));
}

function loadYPercent(): number {
  try {
    const raw = localStorage.getItem(LS_KEY_FAB_Y);
    if (raw) {
      const pct = parseFloat(raw);
      if (!isNaN(pct) && pct >= 0 && pct <= 100) return clampYPercent(pct);
    }
  } catch { /* ignore */ }
  return DEFAULT_FAB_Y_PERCENT;
}

export function AgentFAB({ onClick }: Props) {
  const [yPercent, setYPercent] = useState(DEFAULT_FAB_Y_PERCENT);
  const [hydrated, setHydrated] = useState(false);
  const yPercentRef = useRef(yPercent);
  const dragRef = useRef<{ startY: number; startPct: number } | null>(null);
  const didDrag = useRef(false);

  useEffect(() => {
    const pct = loadYPercent();
    yPercentRef.current = pct;
    setYPercent(pct);
    setHydrated(true);

    function handleResize() {
      // Position is percentage-based so it's already responsive — just force a re-render
      setYPercent(yPercentRef.current);
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    didDrag.current = false;
    dragRef.current = {
      startY: e.clientY,
      startPct: yPercentRef.current,
    };

    function onMouseMove(ev: MouseEvent) {
      if (!dragRef.current) return;
      const dy = ev.clientY - dragRef.current.startY;
      const winH = window.innerHeight;
      const deltaPct = (dy / winH) * 100;
      const newPct = clampYPercent(dragRef.current.startPct + deltaPct);
      if (Math.abs(dy) > 3) didDrag.current = true;
      yPercentRef.current = newPct;
      setYPercent(newPct);
      try {
        localStorage.setItem(LS_KEY_FAB_Y, String(newPct));
      } catch { /* ignore */ }
    }

    function onMouseUp() {
      dragRef.current = null;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, []);

  function handleClick() {
    // Only fire onClick if the user didn't drag
    if (!didDrag.current) {
      onClick();
    }
  }

  if (!hydrated) return null;

  return (
    <button
      type="button"
      data-agent-fab="true"
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      aria-label="Open AI Coworker"
      title="Open AI Coworker"
      style={{
        position: "fixed",
        right: 16,
        top: `${yPercent}%`,
        transform: "translateY(-50%)",
        padding: "8px 16px",
        borderRadius: 20,
        background: "color-mix(in srgb, var(--dpf-accent) 50%, transparent)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        border: "1px solid color-mix(in srgb, var(--dpf-accent) 25%, transparent)",
        cursor: "grab",
        display: "flex",
        alignItems: "center",
        gap: 6,
        boxShadow: "0 4px 16px color-mix(in srgb, var(--dpf-bg) 30%, transparent)",
        zIndex: 50,
        transition: "opacity 0.15s",
        color: "var(--dpf-text)",
        fontSize: 12,
        fontWeight: 500,
        whiteSpace: "nowrap",
        userSelect: "none",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.opacity = "0.9";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.opacity = "1";
      }}
    >
      <span
        className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--dpf-success)]"
        style={{ boxShadow: "0 0 6px color-mix(in srgb, var(--dpf-success) 50%, transparent)" }}
      />
      AI Coworker
    </button>
  );
}
