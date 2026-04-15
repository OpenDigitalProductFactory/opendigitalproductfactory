"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { AgentMessageRow } from "@/lib/agent-coworker-types";
import type { UserContext } from "@/lib/permissions";
import { getOrCreateThreadSnapshot } from "@/lib/actions/agent-coworker";
import { AgentFAB } from "./AgentFAB";
import { AgentCoworkerPanel } from "./AgentCoworkerPanel";
import {
  clampPanelPosition,
  clampPanelSize,
  type PanelPosition,
  type PanelSize,
} from "./agent-panel-layout";
import {
  loadPanelOpen,
  loadPanelPosition,
  loadPanelSize,
  savePanelOpen,
  savePanelPosition,
  savePanelSize,
} from "./agent-panel-prefs";

type Props = {
  userContext: UserContext;
};

function getViewport() {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

export function AgentCoworkerShell({ userContext }: Props) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<PanelPosition>({ x: 0, y: 0 });
  const [size, setSize] = useState<PanelSize>({ width: 380, height: 480 });
  const [hydrated, setHydrated] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [initialMessages, setInitialMessages] = useState<AgentMessageRow[]>([]);
  const [pendingAutoMessage, setPendingAutoMessage] = useState<string | null>(null);
  const positionRef = useRef(position);
  const sizeRef = useRef(size);
  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; startWidth: number; startHeight: number } | null>(null);
  const userKey = userContext.userId ?? `${userContext.isSuperuser ? "super" : "role"}:${userContext.platformRole ?? "none"}`;

  useEffect(() => {
    const viewport = getViewport();
    const initialSize = loadPanelSize(userKey, viewport);
    const initialPosition = loadPanelPosition(userKey, viewport, initialSize);

    sizeRef.current = initialSize;
    positionRef.current = initialPosition;
    setSize(initialSize);
    setPosition(initialPosition);

    if (loadPanelOpen(userKey)) {
      setIsOpen(true);
    }
    setHydrated(true);

    function handleResize() {
      const viewport = getViewport();
      const clampedSize = clampPanelSize(sizeRef.current, viewport);
      const clampedPosition = clampPanelPosition(positionRef.current, clampedSize, viewport);

      if (clampedSize.width !== sizeRef.current.width || clampedSize.height !== sizeRef.current.height) {
        sizeRef.current = clampedSize;
        setSize(clampedSize);
        savePanelSize(userKey, clampedSize);
      }

      if (clampedPosition.x !== positionRef.current.x || clampedPosition.y !== positionRef.current.y) {
        positionRef.current = clampedPosition;
        setPosition(clampedPosition);
        savePanelPosition(userKey, clampedPosition);
      }
    }

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [userKey]);

  // Track active build ID from Build Studio — each build gets its own thread
  const [activeBuildId, setActiveBuildId] = useState<string | null>(null);
  useEffect(() => {
    function handleBuildChange(e: Event) {
      setActiveBuildId((e as CustomEvent<string | null>).detail);
    }
    window.addEventListener("build-studio-active-build", handleBuildChange);
    return () => window.removeEventListener("build-studio-active-build", handleBuildChange);
  }, []);

  // Thread-per-build: when on /build with an active build, scope the thread to that build.
  // This prevents 30+ messages from prior builds polluting the context (saves ~15K tokens/call).
  const threadContext = activeBuildId && pathname === "/build"
    ? `${pathname}#${activeBuildId}`
    : pathname;

  useEffect(() => {
    let active = true;
    setThreadId(null);
    setInitialMessages([]);

    (async () => {
      const snapshot = await getOrCreateThreadSnapshot({ routeContext: threadContext });
      if (!active) return;
      setThreadId(snapshot?.threadId ?? null);
      setInitialMessages(snapshot?.messages ?? []);
    })().catch((error) => {
      console.warn("getOrCreateThreadSnapshot error:", error);
      if (!active) return;
      setThreadId(null);
      setInitialMessages([]);
    });

    return () => {
      active = false;
    };
  }, [threadContext]);

  function handleOpen() {
    setIsOpen(true);
    savePanelOpen(userKey, true);
  }

  function handleClose() {
    setIsOpen(false);
    savePanelOpen(userKey, false);
  }

  // Listen for panel open requests (feedback button, build creation, etc.)
  useEffect(() => {
    function handleOpenPanel(e: Event) {
      setIsOpen(true);
      savePanelOpen(userKey, true);
      const detail = (e as CustomEvent<{ autoMessage?: string; welcomeMessage?: string } | undefined>).detail;
      if (detail?.autoMessage) {
        setPendingAutoMessage(detail.autoMessage);
      }
      // welcomeMessage: inject a pre-written assistant message without LLM call
      if (detail?.welcomeMessage) {
        setInitialMessages((prev) => {
          // Don't duplicate if already present
          if (prev.some((m) => m.content === detail.welcomeMessage)) return prev;
          return [...prev, {
            id: `welcome-${Date.now()}`,
            role: "assistant",
            content: detail.welcomeMessage!,
            createdAt: new Date().toISOString(),
            agentId: "onboarding-coo",
            tone: null,
            routeContext: null,
            providerId: null,
            taskType: null,
            routedEndpointId: null,
          }];
        });
      }
    }
    document.addEventListener("open-agent-feedback", handleOpenPanel);
    document.addEventListener("open-agent-panel", handleOpenPanel);
    return () => {
      document.removeEventListener("open-agent-feedback", handleOpenPanel);
      document.removeEventListener("open-agent-panel", handleOpenPanel);
    };
  }, [userKey]);

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
      const newPos = clampPanelPosition({
        x: dragRef.current.startPosX + dx,
        y: dragRef.current.startPosY + dy,
      }, sizeRef.current, getViewport());
      positionRef.current = newPos;
      setPosition(newPos);
      savePanelPosition(userKey, newPos);
    }

    function onMouseUp() {
      dragRef.current = null;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [userKey]);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startWidth: sizeRef.current.width,
      startHeight: sizeRef.current.height,
    };

    function onMouseMove(ev: MouseEvent) {
      if (!resizeRef.current) return;
      const nextSize = clampPanelSize({
        width: resizeRef.current.startWidth + (ev.clientX - resizeRef.current.startX),
        height: resizeRef.current.startHeight + (ev.clientY - resizeRef.current.startY),
      }, getViewport());

      const nextPosition = clampPanelPosition(positionRef.current, nextSize, getViewport());
      sizeRef.current = nextSize;
      positionRef.current = nextPosition;
      setSize(nextSize);
      setPosition(nextPosition);
      savePanelSize(userKey, nextSize);
      savePanelPosition(userKey, nextPosition);
    }

    function onMouseUp() {
      resizeRef.current = null;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [userKey]);

  if (!hydrated) return null;

  return (
    <>
      {!isOpen && <AgentFAB onClick={handleOpen} />}

      {isOpen && (
        <div
          data-agent-panel="true"
          style={{
            position: "fixed",
            zIndex: 50,
            left: position.x,
            top: position.y,
            width: size.width,
            height: size.height,
            borderRadius: 12,
            background: "color-mix(in srgb, var(--dpf-surface-1) 85%, transparent)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            border: "1px solid var(--dpf-border)",
            boxShadow: "0 8px 32px color-mix(in srgb, var(--dpf-bg) 50%, transparent), 0 2px 8px rgba(0,0,0,0.15)",
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
            pendingAutoMessage={pendingAutoMessage}
            onAutoMessageConsumed={() => setPendingAutoMessage(null)}
            onConversationCleared={() => setInitialMessages([])}
          />
          <div
            onMouseDown={handleResizeStart}
            title="Resize coworker panel"
            style={{
              position: "absolute",
              right: 0,
              bottom: 0,
              width: 18,
              height: 18,
              cursor: "nwse-resize",
              background:
                "linear-gradient(135deg, transparent 0 40%, color-mix(in srgb, var(--dpf-accent) 20%, transparent) 40% 60%, color-mix(in srgb, var(--dpf-accent) 55%, transparent) 60% 100%)",
            }}
          />
        </div>
      )}
    </>
  );
}
