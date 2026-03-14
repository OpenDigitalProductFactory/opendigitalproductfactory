"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentMessageRow } from "@/lib/agent-coworker-types";
import type { UserContext } from "@/lib/permissions";
import { AgentFAB } from "./AgentFAB";
import { AgentCoworkerPanel } from "./AgentCoworkerPanel";

type Props = {
  threadId: string;
  initialMessages: AgentMessageRow[];
  userContext: UserContext;
};

const LS_KEY_OPEN = "agent-panel-open";
const LS_KEY_POS = "agent-panel-position";

const PANEL_W = 380;
const PANEL_H = 480;
const EDGE_GAP = 16;

function loadOpen(): boolean {
  try {
    return localStorage.getItem(LS_KEY_OPEN) === "true";
  } catch {
    return false;
  }
}

function clampPosition(pos: { x: number; y: number }): { x: number; y: number } {
  if (typeof window === "undefined") return pos;
  return {
    x: Math.max(0, Math.min(pos.x, window.innerWidth - PANEL_W)),
    y: Math.max(0, Math.min(pos.y, window.innerHeight - PANEL_H)),
  };
}

function loadPosition(): { x: number; y: number } {
  try {
    const raw = localStorage.getItem(LS_KEY_POS);
    if (raw) {
      const parsed = JSON.parse(raw) as { x: number; y: number };
      if (typeof parsed.x === "number" && typeof parsed.y === "number") return clampPosition(parsed);
    }
  } catch { /* ignore */ }
  return {
    x: typeof window !== "undefined" ? window.innerWidth - PANEL_W - EDGE_GAP : EDGE_GAP,
    y: typeof window !== "undefined" ? window.innerHeight - PANEL_H - EDGE_GAP : EDGE_GAP,
  };
}

export function AgentCoworkerShell({ threadId, initialMessages, userContext }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [hydrated, setHydrated] = useState(false);
  const positionRef = useRef(position);
  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);

  useEffect(() => {
    if (loadOpen()) {
      setIsOpen(true);
    }
    const pos = loadPosition();
    positionRef.current = pos;
    setPosition(pos);
    setHydrated(true);

    // Keep panel in viewport on window resize
    function handleResize() {
      const clamped = clampPosition(positionRef.current);
      if (clamped.x !== positionRef.current.x || clamped.y !== positionRef.current.y) {
        positionRef.current = clamped;
        setPosition(clamped);
      }
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  function handleOpen() {
    setIsOpen(true);
    localStorage.setItem(LS_KEY_OPEN, "true");
  }

  function handleClose() {
    setIsOpen(false);
    localStorage.setItem(LS_KEY_OPEN, "false");
  }

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPosX: positionRef.current.x,
      startPosY: positionRef.current.y,
    };

    function onMouseMove(ev: MouseEvent) {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      const newPos = {
        x: dragRef.current.startPosX + dx,
        y: dragRef.current.startPosY + dy,
      };
      positionRef.current = newPos;
      setPosition(newPos);
      localStorage.setItem(LS_KEY_POS, JSON.stringify(newPos));
    }

    function onMouseUp() {
      dragRef.current = null;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, []);

  if (!hydrated) return null;

  return (
    <>
      {!isOpen && <AgentFAB onClick={handleOpen} />}

      {isOpen && (
        <div
          style={{
            position: "fixed",
            zIndex: 50,
            left: position.x,
            top: position.y,
            width: PANEL_W,
            height: PANEL_H,
            borderRadius: 12,
            background: "rgba(26, 26, 46, 0.7)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            border: "1px solid rgba(42, 42, 64, 0.6)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <AgentCoworkerPanel
            threadId={threadId}
            initialMessages={initialMessages}
            userContext={userContext}
            onClose={handleClose}
            onDragStart={handleDragStart}
          />
        </div>
      )}
    </>
  );
}
