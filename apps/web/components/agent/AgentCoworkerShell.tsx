"use client";

import { useEffect, useState } from "react";
import type { AgentMessageRow } from "@/lib/agent-coworker-types";
import type { UserContext } from "@/lib/permissions";
import { AgentFAB } from "./AgentFAB";
import { AgentCoworkerPanel } from "./AgentCoworkerPanel";

type Props = {
  threadId: string;
  initialMessages: AgentMessageRow[];
  userContext: UserContext;
};

type Phase = "closed" | "expanding" | "open" | "collapsing";

const LS_KEY_OPEN = "agent-panel-open";
const LS_KEY_POS = "agent-panel-position"; // orphaned — cleared on mount

const PANEL_W = 380;
const PANEL_H = 480;
const FAB_SIZE = 44;
const EDGE_GAP = 16;
const ANIM_MS = 300;

function loadOpen(): boolean {
  try {
    return localStorage.getItem(LS_KEY_OPEN) === "true";
  } catch {
    return false;
  }
}

export function AgentCoworkerShell({ threadId, initialMessages, userContext }: Props) {
  const [phase, setPhase] = useState<Phase>("closed");
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage after mount
  useEffect(() => {
    // Clean up orphaned drag position key
    try { localStorage.removeItem(LS_KEY_POS); } catch { /* ignore */ }

    if (loadOpen()) {
      // Skip animation on hydration — go straight to open
      setPhase("open");
    }
    setHydrated(true);
  }, []);

  function handleOpen() {
    setPhase("expanding");
    localStorage.setItem(LS_KEY_OPEN, "true");
  }

  function handleClose() {
    setPhase("collapsing");
    localStorage.setItem(LS_KEY_OPEN, "false");
  }

  function handleTransitionEnd() {
    if (phase === "expanding") setPhase("open");
    if (phase === "collapsing") setPhase("closed");
  }

  if (!hydrated) return null;

  const isExpanded = phase === "expanding" || phase === "open";
  const showContent = phase === "open";
  const showFAB = phase === "closed";

  // Use top+right with pixel values for both states so CSS can transition smoothly.
  // (CSS cannot animate between "auto" and a fixed value — both endpoints must be numbers.)
  // FAB: vertically centered on right edge. Panel: bottom-right.
  // We calculate top in pixels using window.innerHeight for both positions.
  const winH = typeof window !== "undefined" ? window.innerHeight : 800;
  const fabTopPx = Math.round((winH - FAB_SIZE) / 2);
  const panelTopPx = winH - PANEL_H - EDGE_GAP;

  return (
    <>
      {/* FAB — visible only when closed */}
      {showFAB && <AgentFAB onClick={handleOpen} />}

      {/* Morphing container — visible during expanding/open/collapsing */}
      {phase !== "closed" && (
        <div
          onTransitionEnd={handleTransitionEnd}
          style={{
            position: "fixed",
            zIndex: 50,
            // All positional values are numbers so CSS transitions work smoothly
            right: EDGE_GAP,
            top: isExpanded ? panelTopPx : fabTopPx,
            width: isExpanded ? PANEL_W : FAB_SIZE,
            height: isExpanded ? PANEL_H : FAB_SIZE,
            borderRadius: isExpanded ? 12 : FAB_SIZE / 2,
            background: isExpanded ? "rgba(26, 26, 46, 0.85)" : "rgba(124, 140, 248, 0.7)",
            backdropFilter: isExpanded ? "blur(12px)" : "blur(4px)",
            border: `1px solid ${isExpanded ? "rgba(42, 42, 64, 0.6)" : "rgba(124, 140, 248, 0.3)"}`,
            boxShadow: isExpanded
              ? "0 8px 32px rgba(0,0,0,0.4)"
              : "0 4px 16px rgba(0,0,0,0.3)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            transition: `all ${ANIM_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`,
          }}
        >
          {/* Panel content — fades in after expansion */}
          <div
            style={{
              opacity: showContent ? 1 : 0,
              transition: `opacity ${showContent ? "150ms 150ms" : "100ms"}`,
              display: "flex",
              flexDirection: "column",
              flex: 1,
              overflow: "hidden",
            }}
          >
            {showContent && (
              <AgentCoworkerPanel
                threadId={threadId}
                initialMessages={initialMessages}
                userContext={userContext}
                onClose={handleClose}
              />
            )}
          </div>

          {/* FAB dot — visible during collapsing */}
          {phase === "collapsing" && (
            <div style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}>
              <span
                className="inline-block w-2 h-2 rounded-full bg-green-400"
                style={{ boxShadow: "0 0 6px rgba(74, 222, 128, 0.5)" }}
              />
            </div>
          )}
        </div>
      )}
    </>
  );
}
