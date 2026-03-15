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
}: Props) {
  const pathname = usePathname();
  const [messages, setMessages] = useState<AgentRenderableMessage[]>(() => filterMessages(initialMessages));
  const [isPending, startTransition] = useTransition();
  const [isClearing, startClearing] = useTransition();
  const [elevatedAssistEnabled, setElevatedAssistEnabled] = useState(false);
  const [externalAccessEnabled, setExternalAccessEnabled] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const agent: AgentInfo = resolveAgentForRoute(pathname, userContext);
  const preferenceUserKey = userContext.userId ?? `${userContext.isSuperuser ? "super" : "role"}:${userContext.platformRole ?? "none"}`;

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

    startTransition(async () => {
      const result = await sendMessage({
        threadId,
        content,
        routeContext: pathname,
        externalAccessEnabled,
        elevatedFormFillEnabled: elevatedAssistEnabled,
        ...(formAssistContext ? { formAssistContext } : {}),
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
    const result = await approveProposal(proposalId);
    if (result.success) {
      setMessages((prev) =>
        prev.map((m) =>
          m.proposal?.proposalId === proposalId
            ? {
                ...m,
                proposal: {
                  ...m.proposal,
                  status: "executed",
                  ...(result.resultEntityId !== undefined ? { resultEntityId: result.resultEntityId } : {}),
                },
              }
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
      />

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "12px",
        }}
      >
        {messages.length === 0 && (
          <div
            style={{
              textAlign: "center",
              color: "var(--dpf-muted)",
              fontSize: 12,
              padding: "40px 20px",
            }}
          >
            Start a conversation with your AI co-worker
          </div>
        )}
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
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 2,
              marginBottom: 8,
            }}
          >
            <div
              style={{
                padding: "8px 16px",
                borderRadius: "12px 12px 12px 2px",
                fontSize: 13,
                background: "rgba(22, 22, 37, 0.8)",
                color: "var(--dpf-muted)",
              }}
            >
              <span className="animate-pulse">{isClearing ? "Erasing..." : "Thinking..."}</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <AgentMessageInput onSend={handleSend} disabled={isPending || isClearing || !threadId} />
    </>
  );
}
