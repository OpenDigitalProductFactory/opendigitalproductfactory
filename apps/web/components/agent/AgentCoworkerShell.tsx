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
  getDockedPanelFrame,
  getReservedPanelWidth,
  isDockedPanelViewport,
  type DockedPanelFrame,
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

function getShellContentTop(): number {
  const shellContent = document.querySelector<HTMLElement>("[data-shell-content='true']");
  return shellContent?.getBoundingClientRect().top ?? 16;
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
  const [dockedFrame, setDockedFrame] = useState<DockedPanelFrame | null>(null);
  const lastAutoMessageRef = useRef<string | null>(null);
  // Queue auto-messages whose target thread hasn't loaded yet. The panel
  // can't submit to a thread until threadId is set; if the open-agent-panel
  // event arrives while the thread is mid-switch, we hold the message
  // here and release it when the thread context stabilises.
  const [queuedAutoMessage, setQueuedAutoMessage] = useState<{
    message: string;
    targetBuildId: string | null;
  } | null>(null);
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

  // Keep a ref in sync so the async load effect below can read the latest
  // queue without needing queuedAutoMessage in its dependency array (adding
  // it would cancel the in-flight load every time a message is queued).
  const queuedAutoMessageRef = useRef<typeof queuedAutoMessage>(null);
  useEffect(() => {
    queuedAutoMessageRef.current = queuedAutoMessage;
  }, [queuedAutoMessage]);

  useEffect(() => {
    let active = true;
    setThreadId(null);
    setInitialMessages([]);

    console.log("[dpf-debug] Shell fetching snapshot", { threadContext, activeBuildId, pathname });
    (async () => {
      const snapshot = await getOrCreateThreadSnapshot({ routeContext: threadContext });
      if (!active) {
        console.log("[dpf-debug] Shell fetch cancelled (stale)", { threadContext });
        return;
      }
      console.log("[dpf-debug] Shell fetch result", {
        threadContext,
        threadId: snapshot?.threadId,
        messageCount: snapshot?.messages?.length ?? 0,
      });
      setThreadId(snapshot?.threadId ?? null);
      setInitialMessages(snapshot?.messages ?? []);

      // Release a queued auto-message targeted at THIS build now that its
      // thread is loaded. Draining inside the load callback avoids the race
      // where a separate effect fires with activeBuildId already updated
      // but threadId still holding the previous build's id, which would
      // submit the message to the wrong thread.
      const queued = queuedAutoMessageRef.current;
      const expectedBuildId = activeBuildId && pathname === "/build" ? activeBuildId : null;
      if (queued && snapshot?.threadId && queued.targetBuildId === expectedBuildId) {
        setPendingAutoMessage(queued.message);
        setQueuedAutoMessage(null);
      }
    })().catch((error) => {
      console.warn("getOrCreateThreadSnapshot error:", error);
      if (!active) return;
      setThreadId(null);
      setInitialMessages([]);
    });

    return () => {
      active = false;
    };
  }, [threadContext]); // eslint-disable-line react-hooks/exhaustive-deps

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
      const detail = (e as CustomEvent<{ autoMessage?: string; welcomeMessage?: string; targetBuildId?: string } | undefined>).detail;
      if (detail?.autoMessage && detail.autoMessage !== lastAutoMessageRef.current) {
        lastAutoMessageRef.current = detail.autoMessage;
        // If the event targets a specific build, queue the message until the
        // Shell's threadContext advances to that build. Otherwise submit
        // immediately (legacy behaviour — route-level auto-messages, e.g.
        // the onboarding COO introducing each setup step, don't have a
        // targetBuildId and must fire right away).
        if (detail.targetBuildId) {
          setQueuedAutoMessage({ message: detail.autoMessage, targetBuildId: detail.targetBuildId });
        } else {
          setPendingAutoMessage(detail.autoMessage);
        }
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
    if (dockedFrame) return;

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
  }, [dockedFrame, userKey]);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    if (dockedFrame) return;

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
  }, [dockedFrame, userKey]);

  useEffect(() => {
    if (!hydrated) return;

    function syncPanelLayout() {
      const viewport = getViewport();
      const shouldDock = isOpen && isDockedPanelViewport(viewport);
      const reservedWidth = getReservedPanelWidth({
        isOpen: shouldDock,
        size: sizeRef.current,
        viewport,
      });

      document.documentElement.style.setProperty("--agent-panel-reserved-width", `${reservedWidth}px`);

      if (shouldDock) {
        setDockedFrame(
          getDockedPanelFrame({
            size: sizeRef.current,
            viewport,
            shellTop: getShellContentTop(),
          }),
        );
        return;
      }

      setDockedFrame(null);
    }

    syncPanelLayout();
    window.addEventListener("resize", syncPanelLayout);

    return () => {
      window.removeEventListener("resize", syncPanelLayout);
      document.documentElement.style.setProperty("--agent-panel-reserved-width", "0px");
    };
  }, [hydrated, isOpen, pathname, size.width, size.height]);

  if (!hydrated) return null;

  const isDocked = dockedFrame !== null;
  const panelStyle = isDocked && dockedFrame
    ? {
        position: "fixed" as const,
        zIndex: 50,
        left: dockedFrame.left,
        top: dockedFrame.top,
        width: dockedFrame.width,
        height: dockedFrame.height,
        borderRadius: 16,
        background: "color-mix(in srgb, var(--dpf-surface-1) 92%, transparent)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        border: "1px solid var(--dpf-border)",
        boxShadow: "0 8px 32px color-mix(in srgb, var(--dpf-bg) 30%, transparent), 0 2px 8px rgba(0,0,0,0.12)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column" as const,
      }
    : {
        position: "fixed" as const,
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
        flexDirection: "column" as const,
      };

  return (
    <>
      {!isOpen && <AgentFAB onClick={handleOpen} />}

      {isOpen && (
        <div
          data-agent-panel="true"
          style={panelStyle}
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
            routeContextOverride={undefined} /* setup uses each page's native coworker */
            isDocked={isDocked}
          />
          {!isDocked && (
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
          )}
        </div>
      )}
    </>
  );
}
