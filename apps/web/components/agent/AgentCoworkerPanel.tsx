"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import type { AgentMessageRow, AgentInfo } from "@/lib/agent-coworker-types";
import type { UserContext } from "@/lib/permissions";
import { resolveAgentForRoute, AGENT_NAME_MAP } from "@/lib/agent-routing";
import { clearConversation, sendMessage } from "@/lib/actions/agent-coworker";
import { approveProposal, rejectProposal } from "@/lib/actions/proposals";
import { AgentPanelHeader } from "./AgentPanelHeader";
import { AgentMessageBubble } from "./AgentMessageBubble";
import { AgentMessageInput } from "./AgentMessageInput";
import {
  loadElevatedAssistPreference,
  saveElevatedAssistPreference,
} from "./agent-form-assist-prefs";
import {
  loadExternalAccessSessionState,
  saveExternalAccessSessionState,
} from "./agent-external-access-session";
import {
  buildAgentFormAssistContext,
  getActiveFormAssist,
} from "@/lib/agent-form-assist";
import {
  createOptimisticUserMessage,
  failOptimisticMessage,
  reconcileOptimisticMessage,
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
};

function filterMessages(messages: AgentMessageRow[]): AgentMessageRow[] {
  return messages.filter(
    (m) => !(m.role === "system" && m.content.endsWith("has joined the conversation")),
  );
}

function isClearDisabled(
  messages: AgentRenderableMessage[],
  isPending: boolean,
  isClearing: boolean,
  threadId?: string | null,
) {
  return !threadId || messages.length === 0 || isPending || isClearing;
}

export function AgentCoworkerPanel({
  threadId,
  initialMessages,
  userContext,
  onClose,
  onDragStart,
  pendingAutoMessage,
  onAutoMessageConsumed,
}: Props) {
  const pathname = usePathname();
  const [messages, setMessages] = useState<AgentRenderableMessage[]>(() => filterMessages(initialMessages));
  const [isPending, startTransition] = useTransition();
  const [isClearing, startClearing] = useTransition();
  const [elevatedAssistEnabled, setElevatedAssistEnabled] = useState(false);
  const [externalAccessEnabled, setExternalAccessEnabled] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [activeBuildId, setActiveBuildId] = useState<string | null>(null);
  const [pendingAttachment, setPendingAttachment] = useState<{ attachmentId: string; fileName: string; parsedContent: unknown } | null>(null);
  const [lastProviderInfo, setLastProviderInfo] = useState<{ providerId: string; modelId: string } | null>(null);
  const [cooMode, setCooMode] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const routeAgent: AgentInfo = resolveAgentForRoute(pathname, userContext);
  const cooAgent: AgentInfo = resolveAgentForRoute("/workspace", userContext);
  const agent = cooMode ? cooAgent : routeAgent;
  const isCoo = agent.agentId === "coo";
  const canUseCoo = userContext.isSuperuser || userContext.platformRole === "HR-000";
  const preferenceUserKey = userContext.userId ?? `${userContext.isSuperuser ? "super" : "role"}:${userContext.platformRole ?? "none"}`;

  // Elapsed time counter for thinking indicator
  const [thinkingSeconds, setThinkingSeconds] = useState(0);
  useEffect(() => {
    if (!isPending) { setThinkingSeconds(0); return; }
    const t = setInterval(() => setThinkingSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [isPending]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    setMessages(filterMessages(initialMessages));
    setClearConfirmOpen(false);
  }, [threadId, initialMessages]);

  useEffect(() => {
    setElevatedAssistEnabled(loadElevatedAssistPreference(preferenceUserKey, pathname));
    setExternalAccessEnabled(loadExternalAccessSessionState(preferenceUserKey, pathname));
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

  function submitMessage(
    content: string,
    optimisticMessage = createOptimisticUserMessage(content, pathname),
    appendOptimistic = true,
  ) {
    if (!threadId) return;
    const activeFormAssist = elevatedAssistEnabled ? getActiveFormAssist(pathname) : null;
    const formAssistContext = activeFormAssist ? buildAgentFormAssistContext(activeFormAssist) : undefined;
    if (appendOptimistic) {
      setMessages((prev) => [...prev, optimisticMessage]);
    }

    const attachmentForThisMessage = pendingAttachment;
    if (attachmentForThisMessage) setPendingAttachment(null);

    startTransition(async () => {
      const result = await sendMessage({
        threadId,
        content,
        routeContext: cooMode ? "/workspace" : pathname,
        externalAccessEnabled,
        elevatedFormFillEnabled: elevatedAssistEnabled,
        ...(formAssistContext ? { formAssistContext } : {}),
        ...(!cooMode && activeBuildId ? { buildId: activeBuildId } : {}),
        ...(attachmentForThisMessage ? { attachmentId: attachmentForThisMessage.attachmentId } : {}),
      });
      if ("error" in result) {
        console.warn("sendMessage error:", result.error);
        setMessages((prev) =>
          prev.map((message) =>
            message.id === optimisticMessage.id ? failOptimisticMessage(message) : message,
          ),
        );
        return;
      }
      if ("providerInfo" in result) {
        const info = (result as { providerInfo?: { providerId: string; modelId: string } }).providerInfo;
        if (info) setLastProviderInfo(info);
      }
      const newMessages: AgentRenderableMessage[] = [];
      if ("systemMessage" in result && result.systemMessage) {
        newMessages.push(result.systemMessage);
      }
      newMessages.push(result.agentMessage);
      if ("formAssistUpdate" in result && result.formAssistUpdate && activeFormAssist) {
        activeFormAssist.applyFieldUpdates(result.formAssistUpdate);
        newMessages.push({
          id: `local-form-assist-${Date.now()}`,
          role: "system",
          content: "Applied the agent's suggested field updates to the active form for your review.",
          agentId: agent.agentId,
          routeContext: pathname,
          createdAt: new Date().toISOString(),
        });
      }
      setMessages((prev) => {
        const reconciled = prev.flatMap((message) =>
          message.id === optimisticMessage.id
            ? [reconcileOptimisticMessage(message, result.userMessage)]
            : [message],
        );
        return [...reconciled, ...newMessages];
      });
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
    if (isClearDisabled(messages, isPending, isClearing, threadId)) return;
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
        clearDisabled={isClearDisabled(messages, isPending, isClearing, threadId)}
        clearConfirmOpen={clearConfirmOpen}
        elevatedAssistEnabled={elevatedAssistEnabled}
        onToggleElevatedAssist={handleToggleElevatedAssist}
        externalAccessEnabled={externalAccessEnabled}
        onToggleExternalAccess={handleToggleExternalAccess}
        onClose={onClose}
        onDragStart={onDragStart}
        providerInfo={lastProviderInfo}
        cooMode={cooMode}
        canUseCoo={canUseCoo}
        onToggleCoo={() => setCooMode((prev) => !prev)}
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
        {(isPending || isClearing) && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
            {/* Pulsing agent avatar */}
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: "linear-gradient(135deg, rgba(124,140,248,0.3), rgba(124,140,248,0.1))",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                color: "#7c8cf8",
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
                background: "rgba(22, 22, 37, 0.8)",
                color: "var(--dpf-muted)",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span style={{ fontSize: 11 }}>
                {isClearing
                  ? "Clearing conversation"
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
                      background: "#7c8cf8",
                      animation: `dpf-bounce 1.4s ease-in-out ${i * 0.16}s infinite`,
                    }}
                  />
                ))}
              </span>
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

      <AgentMessageInput
        onSend={handleSend}
        disabled={isPending || isClearing || !threadId}
        threadId={threadId}
        pendingFile={pendingAttachment}
        onFileUploaded={setPendingAttachment}
        onFileClear={() => setPendingAttachment(null)}
      />
    </>
  );
}
