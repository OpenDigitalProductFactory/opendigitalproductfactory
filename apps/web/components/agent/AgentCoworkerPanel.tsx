"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import type { AgentMessageRow, AgentInfo } from "@/lib/agent-coworker-types";
import type { UserContext } from "@/lib/permissions";
import { resolveAgentForRoute, AGENT_NAME_MAP } from "@/lib/agent-routing";
import { clearConversation, getOrCreateThreadSnapshot } from "@/lib/actions/agent-coworker";
import { approveProposal, rejectProposal } from "@/lib/actions/proposals";
import { AgentPanelHeader } from "./AgentPanelHeader";
import { AgentMessageBubble } from "./AgentMessageBubble";
import { AgentMessageInput } from "./AgentMessageInput";
import { CoworkerHealthStatus } from "@/components/monitoring/CoworkerHealthStatus";
import { SetupActionButtons } from "@/components/setup/SetupActionButtons";

/** Renders setup action buttons only when the setup overlay is active (data attribute on <html>) */
function SetupActionButtonsWrapper({ isPending }: { isPending: boolean }) {
  const [active, setActive] = useState(false);
  const [isLast, setIsLast] = useState(false);

  useEffect(() => {
    function check() {
      setActive(document.documentElement.hasAttribute("data-setup-active"));
      setIsLast(document.documentElement.getAttribute("data-setup-last-step") === "true");
    }
    check();
    // Re-check on navigation (MutationObserver on the html element's attributes)
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-setup-active", "data-setup-last-step"] });
    return () => observer.disconnect();
  }, []);

  if (!active || isPending) return null;
  return <SetupActionButtons isLastStep={isLast} />;
}
import {
  loadElevatedAssistPreference,
  saveElevatedAssistPreference,
} from "./agent-form-assist-prefs";
import {
  loadExternalAccessSessionState,
  saveExternalAccessSessionState,
  loadCoworkerMode,
  saveCoworkerMode,
  type CoworkerMode,
} from "./agent-external-access-session";
import {
  buildAgentFormAssistContext,
  getActiveFormAssist,
} from "@/lib/agent-form-assist";
import {
  createOptimisticUserMessage,
  failOptimisticMessage,
  retryOptimisticMessage,
  type AgentRenderableMessage,
} from "./agent-message-state";

type Props = {
  threadId: string | null;
  initialMessages: AgentMessageRow[];
  userContext: UserContext;
  onClose: () => void;
  onDragStart: (e: React.MouseEvent) => void;
  pendingAutoMessage?: string | null;
  onAutoMessageConsumed?: () => void;
  onConversationCleared?: () => void;
};

function filterMessages(messages: AgentMessageRow[]): AgentMessageRow[] {
  return messages.filter(
    (m) => !(m.role === "system" && m.content.endsWith("has joined the conversation")),
  );
}

function isClearDisabled(
  messages: AgentRenderableMessage[],
  busy: boolean,
  isClearing: boolean,
  threadId?: string | null,
) {
  return !threadId || messages.length === 0 || busy || isClearing;
}

export function AgentCoworkerPanel({
  threadId,
  initialMessages,
  userContext,
  onClose,
  onDragStart,
  pendingAutoMessage,
  onAutoMessageConsumed,
  onConversationCleared,
}: Props) {
  const pathname = usePathname();
  const [messages, setMessages] = useState<AgentRenderableMessage[]>(() => filterMessages(initialMessages));
  // EP-ASYNC-COWORKER-001: isBusy replaces useTransition's isPending for message flow.
  // This is a plain useState — it does NOT block the Next.js router or prevent navigation.
  const [isBusy, setIsBusy] = useState(false);
  const [isClearing, startClearing] = useTransition();
  const [elevatedAssistEnabled, setElevatedAssistEnabled] = useState(false);
  const [externalAccessEnabled, setExternalAccessEnabled] = useState(false);
  // Build Studio defaults to Act mode — its purpose is building, not advising
  const [coworkerMode, setCoworkerMode] = useState<CoworkerMode>(() =>
    pathname.startsWith("/build") ? "act" : "advise"
  );
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [activeBuildId, setActiveBuildId] = useState<string | null>(null);
  const [pendingAttachment, setPendingAttachment] = useState<{ attachmentId: string; fileName: string; parsedContent: unknown } | null>(null);
  const [lastProviderInfo, setLastProviderInfo] = useState<{ providerId: string; modelId: string } | null>(null);
  const [devMode, setDevMode] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const routeAgent: AgentInfo = resolveAgentForRoute(pathname, userContext);
  const agent = routeAgent;
  const canUseDev = userContext.isSuperuser || userContext.platformRole === "HR-000" || userContext.platformRole === "HR-300";
  const preferenceUserKey = userContext.userId ?? `${userContext.isSuperuser ? "super" : "role"}:${userContext.platformRole ?? "none"}`;

  // Elapsed time counter for thinking indicator
  const [thinkingSeconds, setThinkingSeconds] = useState(0);
  const [currentTool, setCurrentTool] = useState<string | null>(null);
  const [orchestratorStatus, setOrchestratorStatus] = useState<string | null>(null);
  useEffect(() => {
    if (!isBusy) { setThinkingSeconds(0); return; }
    const t = setInterval(() => setThinkingSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [isBusy]);

  // SSE for tool-level progress, orchestrator status, and async completion
  useEffect(() => {
    if (!isBusy || !threadId) { setCurrentTool(null); setOrchestratorStatus(null); return; }
    const es = new EventSource(`/api/agent/stream?threadId=${threadId}`);
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "tool:start") setCurrentTool(data.tool);
        if (data.type === "tool:complete") setCurrentTool(null);
        // Orchestrator progress — show specialist status to user
        if (data.type === "orchestrator:build_started") {
          setOrchestratorStatus(`Starting build: ${data.taskCount} tasks across ${data.specialists.length} specialists`);
        }
        if (data.type === "orchestrator:task_dispatched") {
          setOrchestratorStatus(`${data.specialist} working on: ${data.taskTitle}`);
        }
        if (data.type === "orchestrator:task_complete") {
          setOrchestratorStatus(`${data.specialist} complete`);
        }
        if (data.type === "orchestrator:phase_summary") {
          setOrchestratorStatus(`${data.completed}/${data.total} tasks done`);
        }
        if (data.type === "orchestrator:specialist_retry") {
          setOrchestratorStatus(`Retrying ${data.specialist} (attempt ${data.attempt})`);
        }
        // EP-ASYNC-COWORKER-001: error event — show in chat
        if (data.type === "error") {
          setMessages((prev) => [...prev, {
            id: `local-error-${Date.now()}`,
            role: "system" as const,
            content: data.message ?? "An error occurred during agent execution.",
            agentId: agent.agentId,
            routeContext: pathname,
            createdAt: new Date().toISOString(),
          }]);
        }
        // EP-ASYNC-COWORKER-001: enriched done — fetch messages from DB and apply ephemeral data
        if (data.type === "done") {
          setCurrentTool(null);
          setOrchestratorStatus(null);

          // Apply ephemeral data not stored in DB
          if (data.providerInfo) {
            setLastProviderInfo(data.providerInfo);
          }
          if (data.formAssistUpdate && activeFormAssistRef.current) {
            activeFormAssistRef.current.applyFieldUpdates(data.formAssistUpdate);
          }

          // Refresh messages from DB — authoritative source
          getOrCreateThreadSnapshot({ routeContext: pathname }).then((snapshot) => {
            if (snapshot) {
              setMessages(filterMessages(snapshot.messages));
            }
            setIsBusy(false);
          }).catch(() => {
            setIsBusy(false);
          });
        }

        // Relay build-relevant events to BuildStudio via DOM event.
        // The panel is always SSE-connected when busy; BuildStudio may not
        // have a threadId yet, so this relay is the primary update channel.
        const RELAY_TYPES = ["phase:change", "evidence:update", "sandbox:ready", "orchestrator:task_complete", "done"];
        if (RELAY_TYPES.includes(data.type)) {
          window.dispatchEvent(new CustomEvent("build-progress-update", { detail: data }));
        }
      } catch { /* ignore */ }
    };
    // SSE connection lost — don't mark as "Not sent", show reconnection attempt
    es.onerror = () => {
      // EventSource auto-reconnects. If the server already emitted "done" while
      // disconnected, the reconnection won't see it. The periodic recovery poll
      // below will catch this case.
    };

    // Periodic recovery: check DB every 15 seconds while busy.
    // Catches missed SSE "done" events (connection drops, server restart, etc.)
    const recoveryInterval = setInterval(() => {
      getOrCreateThreadSnapshot({ routeContext: pathname }).then((snapshot) => {
        if (!snapshot) return;
        const latestMsg = snapshot.messages[snapshot.messages.length - 1];
        if (latestMsg && (latestMsg.role === "assistant" || latestMsg.role === "system")) {
          setMessages(filterMessages(snapshot.messages));
          setIsBusy(false);
          setCurrentTool(null);
          setOrchestratorStatus(null);
        }
      }).catch(() => {});
    }, 15_000);

    return () => { es.close(); clearInterval(recoveryInterval); setCurrentTool(null); setOrchestratorStatus(null); };
  }, [isBusy, threadId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    setMessages(filterMessages(initialMessages));
    setClearConfirmOpen(false);
  }, [threadId, initialMessages]);

  // EP-ASYNC-COWORKER-001: When thread changes (user navigated to another page),
  // reset isBusy and probe the server to check if this thread has an active execution.
  // This handles the re-entrant scenario: user leaves while COO is working on /workspace,
  // starts a new task on /employee, then comes back to /workspace — the thinking
  // indicator resumes if the COO is still executing.
  useEffect(() => {
    setIsBusy(false);
    setCurrentTool(null);
    setOrchestratorStatus(null);
    if (!threadId) return;
    let cancelled = false;
    fetch(`/api/agent/status?threadId=${threadId}`).then(async (res) => {
      if (cancelled) return;
      const body = await res.json().catch(() => null);
      if (body?.active) {
        setIsBusy(true); // Resume SSE listener and thinking indicator
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [threadId]);

  useEffect(() => {
    setElevatedAssistEnabled(loadElevatedAssistPreference(preferenceUserKey, pathname));
    setExternalAccessEnabled(loadExternalAccessSessionState(preferenceUserKey, pathname));
    setCoworkerMode(loadCoworkerMode(preferenceUserKey, pathname));
  }, [pathname, preferenceUserKey]);

  useEffect(() => {
    function handleBuildChange(e: Event) {
      const buildId = (e as CustomEvent<string | null>).detail;
      setActiveBuildId(buildId);
    }
    window.addEventListener("build-studio-active-build", handleBuildChange);
    return () => window.removeEventListener("build-studio-active-build", handleBuildChange);
  }, []);

  // Auto-send a message when triggered by build creation or other events
  useEffect(() => {
    if (pendingAutoMessage && threadId) {
      submitMessage(pendingAutoMessage);
      onAutoMessageConsumed?.();
    }
  }, [pendingAutoMessage, threadId]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleToggleElevatedAssist() {
    setElevatedAssistEnabled((prev) => {
      const next = !prev;
      saveElevatedAssistPreference(preferenceUserKey, pathname, next);
      return next;
    });
  }

  function handleToggleExternalAccess() {
    setExternalAccessEnabled((prev) => {
      const next = !prev;
      saveExternalAccessSessionState(preferenceUserKey, pathname, next);
      return next;
    });
  }

  function handleToggleCoworkerMode() {
    setCoworkerMode((prev) => {
      const next: CoworkerMode = prev === "advise" ? "act" : "advise";
      saveCoworkerMode(preferenceUserKey, pathname, next);
      return next;
    });
  }

  // EP-ASYNC-COWORKER-001: activeFormAssist ref for SSE done handler
  const activeFormAssistRef = useRef<ReturnType<typeof getActiveFormAssist>>(null);
  activeFormAssistRef.current = elevatedAssistEnabled ? getActiveFormAssist(pathname) : null;

  function submitMessage(
    content: string,
    optimisticMessage = createOptimisticUserMessage(content, pathname),
    appendOptimistic = true,
  ) {
    if (!threadId) return;
    const formAssistContext = activeFormAssistRef.current
      ? buildAgentFormAssistContext(activeFormAssistRef.current)
      : undefined;
    if (appendOptimistic) {
      setMessages((prev) => [...prev, optimisticMessage]);
    }

    const attachmentForThisMessage = pendingAttachment;
    if (attachmentForThisMessage) setPendingAttachment(null);

    setIsBusy(true);

    // EP-ASYNC-COWORKER-001: Non-blocking fetch to API route.
    // Returns immediately. Agent execution runs in background on the server.
    // Completion is signaled via SSE "done" event (handled in useEffect below).
    fetch("/api/agent/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threadId,
        content,
        routeContext: pathname,
        coworkerMode: devMode || pathname.startsWith("/build") ? "act" : coworkerMode,
        externalAccessEnabled: devMode || coworkerMode === "act" ? true : externalAccessEnabled,
        elevatedFormFillEnabled: elevatedAssistEnabled,
        ...(formAssistContext ? { formAssistContext } : {}),
        ...(activeBuildId ? { buildId: activeBuildId } : {}),
        ...(attachmentForThisMessage ? { attachmentId: attachmentForThisMessage.attachmentId } : {}),
      }),
    }).then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Send failed" }));
        console.warn("[submitMessage] send failed:", body.error);
        setMessages((prev) =>
          prev.map((message) =>
            message.id === optimisticMessage.id ? failOptimisticMessage(message) : message,
          ),
        );
        setIsBusy(false);
      } else {
        // Server accepted — mark as sent so user sees delivery confirmation
        // instead of "Sending..." for the entire duration of agent execution.
        setMessages((prev) =>
          prev.map((message) =>
            message.id === optimisticMessage.id ? { ...message, deliveryState: "sent" as const } : message,
          ),
        );
        // Notify BuildStudio of the threadId so it can connect SSE as a fallback.
        // The server writes threadId to the build on first message (fire-and-forget),
        // so by the time the response arrives, the link exists in the DB.
        if (activeBuildId && threadId) {
          window.dispatchEvent(new CustomEvent("build-thread-linked", {
            detail: { buildId: activeBuildId, threadId },
          }));
        }
      }
    }).catch((e) => {
      console.error("[submitMessage] network error:", e);
      setMessages((prev) =>
        prev.map((message) =>
          message.id === optimisticMessage.id ? failOptimisticMessage(message) : message,
        ),
      );
      setIsBusy(false);
    });
  }

  function handleSend(content: string) {
    submitMessage(content);
  }

  function handleRetry(messageId: string) {
    const failedMessage = messages.find(
      (message) => message.id === messageId && message.role === "user" && message.deliveryState === "failed",
    );
    if (!failedMessage) return;
    const retryContent = failedMessage.retryContent ?? failedMessage.content;

    const retriedMessage = retryOptimisticMessage(failedMessage);
    setMessages((prev) =>
      prev.map((message) => (message.id === messageId ? retriedMessage : message)),
    );
    submitMessage(retryContent, retriedMessage, false);
  }

  async function handleApprove(proposalId: string) {
    try {
      const result = await approveProposal(proposalId);
      const msg = messages.find((m) => m.proposal?.proposalId === proposalId);
      const actionType = msg?.proposal?.actionType ?? "action";

      setMessages((prev) =>
        prev.map((m) =>
          m.proposal?.proposalId === proposalId
            ? {
                ...m,
                proposal: {
                  ...m.proposal,
                  status: result.success ? "executed" : "failed",
                  ...(result.resultEntityId !== undefined ? { resultEntityId: result.resultEntityId } : {}),
                  ...(result.error !== undefined ? { resultError: result.error } : {}),
                },
              }
            : m,
        ),
      );

      // Auto-send a follow-up so the agent reacts to the result
      if (result.success) {
        const followUp = result.resultEntityId
          ? `I approved ${actionType.replace(/_/g, " ")}. Result: ${result.resultEntityId}. What's next?`
          : `I approved ${actionType.replace(/_/g, " ")}. What's next?`;
        submitMessage(followUp);
      }
    } catch (e) {
      console.error("[handleApprove]", e);
      setMessages((prev) =>
        prev.map((m) =>
          m.proposal?.proposalId === proposalId
            ? { ...m, proposal: { ...m.proposal, status: "failed", resultError: "Execution failed" } }
            : m,
        ),
      );
    }
  }

  async function handleReject(proposalId: string) {
    const result = await rejectProposal(proposalId);
    if (result.success) {
      setMessages((prev) =>
        prev.map((m) =>
          m.proposal?.proposalId === proposalId
            ? { ...m, proposal: { ...m.proposal, status: "rejected" } }
            : m,
        ),
      );
    }
  }

  function handleOpenClearConfirm() {
    if (isClearDisabled(messages, isBusy, isClearing, threadId)) return;
    setClearConfirmOpen(true);
  }

  function handleCancelClearConfirm() {
    setClearConfirmOpen(false);
  }

  function handleConfirmClear() {
    if (!threadId) return;
    setClearConfirmOpen(false);

    startClearing(async () => {
      const result = await clearConversation({ threadId });
      if ("error" in result) {
        console.warn("clearConversation error:", result.error);
        return;
      }
      setMessages([]);
      onConversationCleared?.();
    });
  }

  return (
    <>
      <AgentPanelHeader
        agent={agent}
        userContext={userContext}
        onSend={handleSend}
        onOpenClearConfirm={handleOpenClearConfirm}
        onCancelClearConfirm={handleCancelClearConfirm}
        onConfirmClear={handleConfirmClear}
        clearDisabled={isClearDisabled(messages, isBusy, isClearing, threadId)}
        clearConfirmOpen={clearConfirmOpen}
        elevatedAssistEnabled={elevatedAssistEnabled}
        onToggleElevatedAssist={handleToggleElevatedAssist}
        externalAccessEnabled={externalAccessEnabled}
        onToggleExternalAccess={handleToggleExternalAccess}
        onClose={onClose}
        onDragStart={onDragStart}
        providerInfo={lastProviderInfo}
        devMode={devMode}
        canUseDev={canUseDev}
        onToggleDev={() => setDevMode((prev) => !prev)}
        coworkerMode={coworkerMode}
        onToggleCoworkerMode={handleToggleCoworkerMode}
        sensitivityLevel={agent.sensitivity}
      />

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "12px",
        }}
      >
        {messages.map((msg, i) => {
          const prevAgentId = i > 0 ? messages[i - 1]?.agentId : null;
          const showAgentLabel = msg.role === "assistant" && msg.agentId !== prevAgentId;
          return (
            <AgentMessageBubble
              key={msg.id}
              message={msg}
              showAgentLabel={showAgentLabel}
              agentName={showAgentLabel && msg.agentId ? (AGENT_NAME_MAP[msg.agentId] ?? msg.agentId) : null}
              onApprove={handleApprove}
              onReject={handleReject}
              {...(msg.deliveryState ? { deliveryState: msg.deliveryState } : {})}
              {...(msg.deliveryState === "failed" ? { onRetry: () => handleRetry(msg.id) } : {})}
            />
          );
        })}
        {/* Setup action buttons — shown when setup overlay is active */}
        <SetupActionButtonsWrapper isPending={isBusy} />
        {(isBusy || isClearing) && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
            {/* Pulsing agent avatar */}
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: "linear-gradient(135deg, color-mix(in srgb, var(--dpf-accent) 30%, transparent), color-mix(in srgb, var(--dpf-accent) 10%, transparent))",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                color: "var(--dpf-accent)",
                flexShrink: 0,
                animation: "dpf-pulse 2s ease-in-out infinite",
              }}
            >
              {agent.agentName.charAt(0)}
            </div>
            <div
              style={{
                padding: "8px 14px",
                borderRadius: "12px 12px 12px 2px",
                fontSize: 12,
                background: "color-mix(in srgb, var(--dpf-surface-1) 80%, transparent)",
                color: "var(--dpf-muted)",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span style={{ fontSize: 11 }}>
                {isClearing
                  ? "Clearing conversation"
                  : orchestratorStatus
                    ? orchestratorStatus
                    : currentTool
                      ? `${agent.agentName} is using ${currentTool.replace(/_/g, " ")}...`
                      : thinkingSeconds < 5
                        ? `${agent.agentName} is thinking`
                        : thinkingSeconds < 15
                          ? `${agent.agentName} is working on it`
                          : `${agent.agentName} is still working (${thinkingSeconds}s)`}
              </span>
              {/* Animated bouncing dots */}
              <span style={{ display: "inline-flex", gap: 2, alignItems: "center" }}>
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    style={{
                      width: 4,
                      height: 4,
                      borderRadius: "50%",
                      background: "var(--dpf-accent)",
                      animation: `dpf-bounce 1.4s ease-in-out ${i * 0.16}s infinite`,
                    }}
                  />
                ))}
              </span>
              {/* EP-ASYNC-COWORKER-001: Cancel button after 15s */}
              {!isClearing && thinkingSeconds >= 15 && threadId && (
                <button
                  type="button"
                  onClick={() => {
                    fetch("/api/agent/cancel", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ threadId }),
                    }).catch(() => {});
                  }}
                  style={{
                    background: "none",
                    border: "1px solid color-mix(in srgb, var(--dpf-text) 15%, transparent)",
                    borderRadius: 999,
                    color: "var(--dpf-muted)",
                    cursor: "pointer",
                    fontSize: 10,
                    lineHeight: 1,
                    padding: "2px 8px",
                    marginLeft: 4,
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
            <style>{`
              @keyframes dpf-bounce {
                0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
                40% { transform: translateY(-5px); opacity: 1; }
              }
              @keyframes dpf-pulse {
                0%, 100% { opacity: 0.6; transform: scale(1); }
                50% { opacity: 1; transform: scale(1.05); }
              }
            `}</style>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <CoworkerHealthStatus />
      <AgentMessageInput
        onSend={handleSend}
        disabled={isClearing || !threadId}
        busy={isBusy}
        threadId={threadId}
        pendingFile={pendingAttachment}
        onFileUploaded={setPendingAttachment}
        onFileClear={() => setPendingAttachment(null)}
      />
    </>
  );
}
