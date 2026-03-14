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

const LS_KEY_OPEN = "agent-panel-open";

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

export function AgentCoworkerShell({ threadId, initialMessages, userContext }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // Clean up orphaned drag position key
    try { localStorage.removeItem("agent-panel-position"); } catch { /* ignore */ }

    if (loadOpen()) {
      setIsOpen(true);
    }
    setHydrated(true);
  }, []);

  function handleOpen() {
    setIsOpen(true);
    localStorage.setItem(LS_KEY_OPEN, "true");
  }

  function handleClose() {
    setIsOpen(false);
    localStorage.setItem(LS_KEY_OPEN, "false");
  }

  if (!hydrated) return null;

  return (
    <>
      {/* FAB — visible when panel is closed */}
      {!isOpen && <AgentFAB onClick={handleOpen} />}

      {/* Panel — fixed bottom-right, semi-transparent */}
      {isOpen && (
        <div
          style={{
            position: "fixed",
            zIndex: 50,
            right: EDGE_GAP,
            bottom: EDGE_GAP,
            width: PANEL_W,
            height: PANEL_H,
            borderRadius: 12,
            background: "rgba(26, 26, 46, 0.85)",
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
          />
        </div>
      )}
    </>
  );
}
