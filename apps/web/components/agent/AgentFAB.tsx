"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  onClick: () => void;
};

const LS_KEY_FAB_Y = "agent-fab-y-pct";

function loadYPercent(): number {
  try {
    const raw = localStorage.getItem(LS_KEY_FAB_Y);
    if (raw) {
      const pct = parseFloat(raw);
      if (!isNaN(pct) && pct >= 0 && pct <= 100) return pct;
    }
  } catch { /* ignore */ }
  return 50; // default: vertically centered
}

export function AgentFAB({ onClick }: Props) {
  const [yPercent, setYPercent] = useState(50);
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
      const newPct = Math.max(5, Math.min(95, dragRef.current.startPct + deltaPct));
      if (Math.abs(dy) > 3) didDrag.current = true;
      yPercentRef.current = newPct;
      setYPercent(newPct);
      localStorage.setItem(LS_KEY_FAB_Y, String(newPct));
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
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      title="Open AI Co-worker"
      style={{
        position: "fixed",
        right: 16,
        top: `${yPercent}%`,
        transform: "translateY(-50%)",
        padding: "8px 16px",
        borderRadius: 20,
        background: "rgba(124, 140, 248, 0.5)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        border: "1px solid rgba(124, 140, 248, 0.25)",
        cursor: "grab",
        display: "flex",
        alignItems: "center",
        gap: 6,
        boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
        zIndex: 50,
        transition: "opacity 0.15s",
        color: "#ffffff",
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
        className="inline-block w-1.5 h-1.5 rounded-full bg-green-400"
        style={{ boxShadow: "0 0 6px rgba(74, 222, 128, 0.5)" }}
      />
      AI Coworker
    </button>
  );
}
