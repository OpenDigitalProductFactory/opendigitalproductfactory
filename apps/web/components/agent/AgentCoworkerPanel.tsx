"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import type { AgentMessageRow, AgentInfo } from "@/lib/agent-coworker-types";
import type { UserContext } from "@/lib/permissions";
import { resolveAgentForRoute, AGENT_NAME_MAP } from "@/lib/agent-routing";
import { clearConversation, sendMessage } from "@/lib/actions/agent-coworker";
import { AgentPanelHeader } from "./AgentPanelHeader";
import { AgentMessageBubble } from "./AgentMessageBubble";
import { AgentMessageInput } from "./AgentMessageInput";
import {
  loadElevatedAssistPreference,
  saveElevatedAssistPreference,
} from "./agent-form-assist-prefs";
import {
  buildAgentFormAssistContext,
  getActiveFormAssist,
} from "@/lib/agent-form-assist";

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

export function AgentCoworkerPanel({
  threadId,
  initialMessages,
  userContext,
  onClose,
  onDragStart,
}: Props) {
  const pathname = usePathname();
  const [messages, setMessages] = useState<AgentMessageRow[]>(() => filterMessages(initialMessages));
  const [isPending, startTransition] = useTransition();
  const [isClearing, startClearing] = useTransition();
  const [elevatedAssistEnabled, setElevatedAssistEnabled] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const agent: AgentInfo = resolveAgentForRoute(pathname, userContext);
  const preferenceUserKey = userContext.userId ?? `${userContext.isSuperuser ? "super" : "role"}:${userContext.platformRole ?? "none"}`;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    setMessages(filterMessages(initialMessages));
  }, [threadId, initialMessages]);

  useEffect(() => {
    setElevatedAssistEnabled(loadElevatedAssistPreference(preferenceUserKey, pathname));
  }, [pathname, preferenceUserKey]);

  function handleToggleElevatedAssist() {
    setElevatedAssistEnabled((prev) => {
      const next = !prev;
      saveElevatedAssistPreference(preferenceUserKey, pathname, next);
      return next;
    });
  }

  function handleSend(content: string) {
    if (!threadId) return;
    const activeFormAssist = elevatedAssistEnabled ? getActiveFormAssist(pathname) : null;
    const formAssistContext = activeFormAssist ? buildAgentFormAssistContext(activeFormAssist) : undefined;

    startTransition(async () => {
      const result = await sendMessage({
        threadId,
        content,
        routeContext: pathname,
        elevatedFormFillEnabled: elevatedAssistEnabled,
        ...(formAssistContext ? { formAssistContext } : {}),
      });
      if ("error" in result) {
        console.warn("sendMessage error:", result.error);
        return;
      }
      const newMessages = [result.userMessage];
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
      setMessages((prev) => [...prev, ...newMessages]);
    });
  }

  function handleClear() {
    if (!threadId) return;
    if (typeof window !== "undefined" && !window.confirm("Erase the current page conversation?")) {
      return;
    }

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
        onClear={handleClear}
        clearDisabled={!threadId || messages.length === 0 || isPending || isClearing}
        elevatedAssistEnabled={elevatedAssistEnabled}
        onToggleElevatedAssist={handleToggleElevatedAssist}
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
