"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { AgentMessageRow } from "@/lib/agent-coworker-types";
import type { UserContext } from "@/lib/permissions";
import { getOrCreateThreadSnapshot, getThreadSnapshotById } from "@/lib/actions/agent-coworker";
import { startProviderComplianceConsultation } from "@/lib/actions/provider-compliance-consultation";
import { startFeedbackSupport } from "@/lib/actions/feedback-support";
import {
  isFeedbackEventDetail,
  type FeedbackEventDetail,
} from "@/lib/feedback/feedback-event";
import { AgentFAB } from "./AgentFAB";
import { AgentCoworkerPanel } from "./AgentCoworkerPanel";
import type { ThreadLoadState } from "./composer-state";
import type { ProviderReviewPacket } from "@/lib/routing/provider-suitability/provider-review-packet";
import {
  planAutoMessage,
  queuedAutoMessageIsForThread,
  shouldSuppressAutoMessage,
} from "./agent-auto-message";
import {
  clampPanelPosition,
  clampPanelSize,
  getDockedPanelFrame,
  getReservedPanelWidth,
  isDockedPanelViewport,
  isMobilePanelViewport,
  type DockedPanelFrame,
  type PanelPosition,
  type PanelSize,
} from "./agent-panel-layout";
import { useMobilePanelModal } from "./use-mobile-panel-modal";
import {
  loadPanelOpen,
  loadPanelPosition,
  loadPanelSize,
  savePanelOpen,
  savePanelPosition,
  savePanelSize,
} from "./agent-panel-prefs";
import {
  OPEN_AGENT_FEEDBACK_EVENT,
  SUPPORT_WELCOME_MESSAGE,
} from "@/components/feedback/support-entry";

type Props = {
  userContext: UserContext;
  useUnifiedCoworker: boolean;
  cooConversationalName?: string | null;
};

type PendingSupportSession = {
  detail: FeedbackEventDetail;
  featureBuildId: string | null;
};

type OpenAgentPanelDetail = {
  autoMessage?: string;
  displayMessage?: string;
  welcomeMessage?: string;
  targetBuildId?: string;
  routeContext?: string;
  providerReviewPacket?: ProviderReviewPacket;
};

type PendingProviderConsultation = {
  packet: ProviderReviewPacket;
  routeContext: string;
};

type QueuedAutoMessage = {
  message: string;
  targetBuildId: string | null;
  routeContext: string | null;
};

function getViewport() {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

function cleanRouteContext(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function getShellContentTop(): number {
  const shellContent = document.querySelector<HTMLElement>("[data-shell-content='true']");
  return shellContent?.getBoundingClientRect().top ?? 16;
}

// BI-DED493BA: proactive on-load briefing. Ephemeral assistant bubble appended
// to the loaded history — server-composed from the attention read-model, never
// persisted, so it is fresh on every open. Id is stable per thread context so a
// load retry doesn't duplicate it.
function withOpeningBriefing(
  messages: AgentMessageRow[],
  briefing: { content: string; agentId: string | null } | null | undefined,
  threadContext: string,
): AgentMessageRow[] {
  if (!briefing?.content) return messages;
  const id = `opening-briefing:${threadContext}`;
  if (messages.some((message) => message.id === id)) return messages;
  return [
    ...messages,
    {
      id,
      role: "assistant",
      content: briefing.content,
      createdAt: new Date().toISOString(),
      agentId: briefing.agentId,
      routeContext: threadContext,
    },
  ];
}

function withSupportWelcomeMessage(messages: AgentMessageRow[]): AgentMessageRow[] {
  if (messages.some((message) => message.content === SUPPORT_WELCOME_MESSAGE)) {
    return messages;
  }

  return [
    ...messages,
    {
      id: "support-mode-welcome",
      role: "assistant",
      content: SUPPORT_WELCOME_MESSAGE,
      createdAt: new Date().toISOString(),
      agentId: "dale",
      routeContext: null,
    },
  ];
}

function supportStartFailureMessage(error: unknown): AgentMessageRow {
  const message = error instanceof Error ? error.message : "";
  const content = /too many support sessions/i.test(message)
    ? message
    : "Couldn't start support triage. You can still describe the issue here.";

  return {
    id: `support-mode-start-failed-${Date.now()}`,
    role: "assistant",
    content,
    createdAt: new Date().toISOString(),
    agentId: "dale",
    routeContext: null,
  };
}

export function AgentCoworkerShell({ userContext, useUnifiedCoworker, cooConversationalName = null }: Props) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<PanelPosition>({ x: 0, y: 0 });
  const [size, setSize] = useState<PanelSize>({ width: 380, height: 480 });
  const [hydrated, setHydrated] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [initialMessages, setInitialMessages] = useState<AgentMessageRow[]>([]);
  // Thread snapshot load lifecycle (BI-D028B2A8). A failed load must surface
  // — the old behavior swallowed the error and left a dead composer forever
  // (seen when a stale tab's server actions 404 after a self-upgrade swap).
  const [threadLoadState, setThreadLoadState] = useState<ThreadLoadState>("loading");
  const [threadLoadRetryToken, setThreadLoadRetryToken] = useState(0);
  const threadAutoRetryUsedRef = useRef(false);
  const prevThreadContextRef = useRef<string | null>(null);
  const [pendingAutoMessage, setPendingAutoMessage] = useState<string | null>(null);
  const [pendingAutoMessageDisplay, setPendingAutoMessageDisplay] = useState<string | null>(null);
  const [pendingProviderConsultation, setPendingProviderConsultation] =
    useState<PendingProviderConsultation | null>(null);
  const providerConsultationInFlightRef = useRef<string | null>(null);
  const [guidedRouteContext, setGuidedRouteContext] = useState<string | null>(null);
  const [dockedFrame, setDockedFrame] = useState<DockedPanelFrame | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const lastAutoMessageRef = useRef<{ signature: string; at: number } | null>(null);
  // Queue auto-messages whose target thread hasn't loaded yet. The panel
  // can't submit to a thread until threadId is set; if the open-agent-panel
  // event arrives while the thread is mid-switch, we hold the message
  // here and release it when the thread context stabilises.
  const [queuedAutoMessage, setQueuedAutoMessage] = useState<QueuedAutoMessage | null>(null);
  const pendingSupportSessionsRef = useRef<Map<string, PendingSupportSession>>(new Map());
  const startedSupportSessionsRef = useRef<Set<string>>(new Set());
  const lastFocusRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const positionRef = useRef(position);
  const sizeRef = useRef(size);
  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; startWidth: number; startHeight: number } | null>(null);
  const userKey = userContext.userId ?? `${userContext.isSuperuser ? "super" : "role"}:${userContext.platformRole ?? "none"}`;

  function beginFeedbackSupport(session: PendingSupportSession, resolvedThreadId: string | null) {
    if (!resolvedThreadId) {
      pendingSupportSessionsRef.current.set(session.detail.supportSessionId, session);
      return;
    }

    if (startedSupportSessionsRef.current.has(session.detail.supportSessionId)) {
      pendingSupportSessionsRef.current.delete(session.detail.supportSessionId);
      return;
    }

    startedSupportSessionsRef.current.add(session.detail.supportSessionId);
    pendingSupportSessionsRef.current.delete(session.detail.supportSessionId);

    void startFeedbackSupport({
      detail: session.detail,
      featureBuildId: session.featureBuildId,
      threadId: resolvedThreadId,
    }).catch((error) => {
      console.warn("startFeedbackSupport error:", error);
      setInitialMessages((prev) => [...prev, supportStartFailureMessage(error)]);
    });
  }

  useEffect(() => {
    const viewport = getViewport();
    const initialSize = loadPanelSize(userKey, viewport);
    const initialPosition = loadPanelPosition(userKey, viewport, initialSize);

    sizeRef.current = initialSize;
    positionRef.current = initialPosition;
    setSize(initialSize);
    setPosition(initialPosition);
    setIsMobile(isMobilePanelViewport(viewport));

    if (loadPanelOpen(userKey)) {
      setIsOpen(true);
    }
    setHydrated(true);

    function handleResize() {
      const viewport = getViewport();
      setIsMobile(isMobilePanelViewport(viewport));
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
  const routeThreadContext = guidedRouteContext ?? pathname;
  const threadContext = activeBuildId && pathname === "/build"
    ? `${pathname}#${activeBuildId}`
    : routeThreadContext;

  // Keep a ref in sync so the async load effect below can read the latest
  // queue without needing queuedAutoMessage in its dependency array (adding
  // it would cancel the in-flight load every time a message is queued).
  const queuedAutoMessageRef = useRef<typeof queuedAutoMessage>(null);
  useEffect(() => {
    queuedAutoMessageRef.current = queuedAutoMessage;
  }, [queuedAutoMessage]);

  useEffect(() => {
    let active = true;
    let autoRetryTimer: number | undefined;
    // A context switch gets a fresh auto-retry budget; a retryToken bump
    // (auto or manual retry) does not.
    if (prevThreadContextRef.current !== threadContext) {
      prevThreadContextRef.current = threadContext;
      threadAutoRetryUsedRef.current = false;
    }
    setThreadId(null);
    setInitialMessages([]);
    setThreadLoadState("loading");

    // One bounded auto-retry (~2s) covers transient blips; after that the
    // panel shows an explicit failed state with a Retry action instead of a
    // silently dead composer.
    const failLoad = () => {
      setThreadId(null);
      setInitialMessages([]);
      if (!threadAutoRetryUsedRef.current) {
        threadAutoRetryUsedRef.current = true;
        autoRetryTimer = window.setTimeout(() => {
          setThreadLoadRetryToken((token) => token + 1);
        }, 2000);
      } else {
        setThreadLoadState("failed");
      }
    };

    (async () => {
      const snapshot = await getOrCreateThreadSnapshot({ routeContext: threadContext });
      if (!active) return;
      // BI-836B0304: a RESOLVED null (not a thrown error) means the session's
      // userId has no matching User row — the only branch in
      // getOrCreateThreadSnapshot that resolves null. Retrying can never
      // succeed (the row will not appear), so skip the bounded auto-retry
      // and go straight to the re-auth prompt instead of eventually landing
      // on the generic "failed" dead banner + silent 503s from companion
      // user-scoped actions.
      if (snapshot === null) {
        setThreadId(null);
        setInitialMessages([]);
        setThreadLoadState("invalid-session");
        return;
      }
      if (!snapshot.threadId) {
        failLoad();
        return;
      }
      setThreadId(snapshot.threadId);
      setThreadLoadState("ready");
      threadAutoRetryUsedRef.current = false;
      const hasPendingSupport = pendingSupportSessionsRef.current.size > 0;
      const baseMessages = hasPendingSupport
        ? withSupportWelcomeMessage(snapshot.messages ?? [])
        : snapshot.messages ?? [];
      setInitialMessages(
        withOpeningBriefing(baseMessages, snapshot.openingBriefing, threadContext),
      );

      for (const session of Array.from(pendingSupportSessionsRef.current.values())) {
        beginFeedbackSupport(session, snapshot.threadId);
      }

      // Release a queued auto-message targeted at THIS build now that its
      // thread is loaded. Draining inside the load callback avoids the race
      // where a separate effect fires with activeBuildId already updated but
      // threadId still holding the previous build's id.
      const queued = queuedAutoMessageRef.current;
      if (queuedAutoMessageIsForThread({
        queued, threadId: snapshot.threadId, activeBuildId, pathname, threadContext,
      })) {
        setPendingAutoMessage(queued!.message);
        setQueuedAutoMessage(null);
      }
    })().catch((error) => {
      console.warn("getOrCreateThreadSnapshot error:", error);
      if (!active) return;
      failLoad();
    });

    return () => {
      active = false;
      if (autoRetryTimer !== undefined) window.clearTimeout(autoRetryTimer);
    };
  }, [threadContext, threadLoadRetryToken]); // eslint-disable-line react-hooks/exhaustive-deps

  // The drain above runs inside the thread-load callback, so a message queued
  // while sitting on an ALREADY-loaded thread stranded forever — which is what
  // made the retry action discard every click with no feedback.
  useEffect(() => {
    if (threadLoadState !== "ready") return;
    if (!queuedAutoMessageIsForThread({
      queued: queuedAutoMessage, threadId, activeBuildId, pathname, threadContext,
    })) return;
    setPendingAutoMessage(queuedAutoMessage!.message);
    setQueuedAutoMessage(null);
  }, [queuedAutoMessage, threadId, threadLoadState, activeBuildId, pathname, threadContext]);

  useEffect(() => {
    if (
      !pendingProviderConsultation
      || !threadId
      || threadLoadState !== "ready"
      || pendingProviderConsultation.routeContext !== threadContext
    ) {
      return;
    }

    const signature = `${threadId}:${JSON.stringify(pendingProviderConsultation.packet)}`;
    if (providerConsultationInFlightRef.current === signature) return;
    providerConsultationInFlightRef.current = signature;
    let active = true;

    void startProviderComplianceConsultation({
      parentThreadId: threadId,
      routeContext: pendingProviderConsultation.routeContext,
      packet: pendingProviderConsultation.packet,
    }).then(async () => {
      const snapshot = await getThreadSnapshotById({ threadId });
      if (active && snapshot?.threadId === threadId) {
        setInitialMessages(snapshot.messages ?? []);
      }
    }).catch((error) => {
      console.warn("startProviderComplianceConsultation error:", error);
      if (!active) return;
      setInitialMessages((messages) => [
        ...messages,
        {
          id: `provider-consultation-failed-${Date.now()}`,
          role: "system",
          content: "DPF could not start the compliance consultation. Provider posture was not changed; try again or request qualified review.",
          createdAt: new Date().toISOString(),
          agentId: null,
          routeContext: pendingProviderConsultation.routeContext,
        },
      ]);
    }).finally(() => {
      if (active) setPendingProviderConsultation(null);
    });

    return () => {
      active = false;
    };
  }, [pendingProviderConsultation, threadContext, threadId, threadLoadState]);

  function handleReloadToReconnect() {
    // A failed load that survives the bounded auto-retry is, in practice, a
    // stale tab after a portal self-upgrade: the redeploy rotated the Next.js
    // server-action IDs, so this tab's cached getOrCreateThreadSnapshot
    // reference 404s and re-invoking it can never succeed. Only a full reload
    // fetches the new client bundle with current action IDs, so recovery is a
    // hard reload rather than a soft re-call of the same dead action.
    window.location.reload();
  }

  function handleOpen() {
    lastFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setIsOpen(true);
    setGuidedRouteContext(null);
    savePanelOpen(userKey, true);
  }

  const handleClose = useCallback(() => {
    setIsOpen(false);
    savePanelOpen(userKey, false);
    window.setTimeout(() => {
      const previousFocus = lastFocusRef.current;
      if (previousFocus?.isConnected) {
        previousFocus.focus();
        return;
      }

      document.querySelector<HTMLElement>("[data-agent-fab='true']")?.focus();
    }, 0);
  }, [userKey]);

  useEffect(() => {
    if (!isOpen) return;
    panelRef.current?.focus();
  }, [isOpen]);

  useMobilePanelModal({
    isOpen,
    isMobile,
    panelRef,
    onClose: handleClose,
  });

  // Listen for panel open requests (feedback button, build creation, etc.)
  useEffect(() => {
    function handleOpenPanel(e: Event) {
      const detail = (e as CustomEvent<OpenAgentPanelDetail | undefined>).detail;
      if (e.type === OPEN_AGENT_FEEDBACK_EVENT) {
        if (!isFeedbackEventDetail((e as CustomEvent<unknown>).detail)) {
          console.warn("Invalid open-agent-feedback detail");
          return;
        }

        e.preventDefault();
        lastFocusRef.current = document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
        setIsOpen(true);
        setGuidedRouteContext(null);
        savePanelOpen(userKey, true);

        const supportDetail = (e as CustomEvent<FeedbackEventDetail>).detail;
        const supportSession = {
          detail: supportDetail,
          featureBuildId: pathname === "/build" ? activeBuildId : null,
        };

        setInitialMessages((prev) => withSupportWelcomeMessage(prev));
        beginFeedbackSupport(supportSession, threadId);
        return;
      }

      lastFocusRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      setIsOpen(true);
      const requestedRouteContext = cleanRouteContext(detail?.routeContext);
      setGuidedRouteContext(requestedRouteContext);
      savePanelOpen(userKey, true);

      if (detail?.autoMessage) {
        setPendingAutoMessageDisplay(detail.displayMessage ?? null);
        const signature = `${detail.autoMessage}::${detail.targetBuildId ?? ""}`;
        const now = Date.now();
        if (shouldSuppressAutoMessage({
          last: lastAutoMessageRef.current,
          nextSignature: signature,
          now,
        })) {
          return;
        }
        lastAutoMessageRef.current = { signature, at: now };
        if (detail.providerReviewPacket) {
          setPendingAutoMessage(null);
          setQueuedAutoMessage(null);
          setPendingProviderConsultation({
            packet: detail.providerReviewPacket,
            routeContext: requestedRouteContext ?? threadContext,
          });
          return;
        }
        const plan = planAutoMessage({
          message: detail.autoMessage,
          targetBuildId: detail.targetBuildId ?? null,
          requestedRouteContext: requestedRouteContext ?? null,
          threadContext, activeBuildId, threadId,
        });
        if (plan.send) setPendingAutoMessage(plan.message);
        else setQueuedAutoMessage(plan);
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
    document.addEventListener(OPEN_AGENT_FEEDBACK_EVENT, handleOpenPanel);
    document.addEventListener("open-agent-panel", handleOpenPanel);
    return () => {
      document.removeEventListener(OPEN_AGENT_FEEDBACK_EVENT, handleOpenPanel);
      document.removeEventListener("open-agent-panel", handleOpenPanel);
    };
  }, [activeBuildId, pathname, threadId, userContext.userId, userKey]);

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
  const usesFixedFrame = isDocked || isMobile;
  const namedCoworkerEntryOwnsRoute =
    pathname === "/platform/ai/overview" ||
    pathname.startsWith("/platform/ai/agent/");
  const panelStyle = isMobile
    ? {
        position: "fixed" as const,
        zIndex: 50,
        inset: 0,
        width: "100vw",
        maxWidth: "100vw",
        minWidth: 0,
        height: "100dvh",
        maxHeight: "100dvh",
        borderRadius: 0,
        background: "var(--dpf-surface-1)",
        border: 0,
        boxShadow: "none",
        boxSizing: "border-box" as const,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column" as const,
      }
    : isDocked && dockedFrame
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
        boxShadow: "0 8px 32px color-mix(in srgb, var(--dpf-bg) 30%, transparent), 0 2px 8px color-mix(in srgb, var(--dpf-bg) 12%, transparent)",
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
        boxShadow: "0 8px 32px color-mix(in srgb, var(--dpf-bg) 50%, transparent), 0 2px 8px color-mix(in srgb, var(--dpf-bg) 15%, transparent)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column" as const,
      };

  return (
    <>
      {!isOpen && !namedCoworkerEntryOwnsRoute && (
        <AgentFAB onClick={handleOpen} />
      )}

      {isOpen && (
        <div
          ref={panelRef}
          data-agent-panel="true"
          role="dialog"
          aria-modal={isMobile ? true : undefined}
          aria-label="AI coworker panel"
          tabIndex={-1}
          style={panelStyle}
          data-panel-layout={isMobile ? "mobile-viewport" : isDocked ? "desktop-docked" : "floating"}
        >
          <AgentCoworkerPanel
            threadId={threadId}
            initialMessages={initialMessages}
            userContext={userContext}
            useUnifiedCoworker={useUnifiedCoworker}
            cooConversationalName={cooConversationalName}
            onClose={handleClose}
            onDragStart={handleDragStart}
            pendingAutoMessage={pendingAutoMessage}
            pendingAutoMessageDisplay={pendingAutoMessageDisplay}
            onAutoMessageConsumed={() => {
              setPendingAutoMessage(null);
              setPendingAutoMessageDisplay(null);
            }}
            onConversationCleared={() => setInitialMessages([])}
            routeContextOverride={guidedRouteContext ?? undefined}
            isDocked={usesFixedFrame}
            threadLoadState={threadLoadState}
            onReloadToReconnect={handleReloadToReconnect}
          />
          {!usesFixedFrame && (
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
