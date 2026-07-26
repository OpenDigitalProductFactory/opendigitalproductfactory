"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bot } from "lucide-react";

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
      className="fixed right-3 z-50 flex h-11 w-11 select-none items-center justify-center gap-1.5 rounded-full p-0 text-xs font-medium text-[var(--dpf-text)] transition-opacity sm:right-4 sm:h-auto sm:w-auto sm:rounded-[20px] sm:px-4 sm:py-2"
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      aria-label="Open AI Coworker"
      title="Open AI Coworker"
      style={{
        top: `${yPercent}%`,
        transform: "translateY(-50%)",
        background: "color-mix(in srgb, var(--dpf-accent) 50%, transparent)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        border: "1px solid color-mix(in srgb, var(--dpf-accent) 25%, transparent)",
        cursor: "grab",
        boxShadow: "0 4px 16px color-mix(in srgb, var(--dpf-bg) 30%, transparent)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.opacity = "0.9";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.opacity = "1";
      }}
    >
      <Bot className="size-4" aria-hidden="true" />
      <span
        className="hidden h-1.5 w-1.5 rounded-full bg-[var(--dpf-success)] sm:inline-block"
        style={{ boxShadow: "0 0 6px color-mix(in srgb, var(--dpf-success) 50%, transparent)" }}
      />
      <span className="hidden whitespace-nowrap sm:inline">AI Coworker</span>
    </button>
  );
}
