"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import type { AgentMessageRow, AgentInfo } from "@/lib/agent-coworker-types";
import type { UserContext } from "@/lib/permissions";
import { resolveAgentForRoute, AGENT_NAME_MAP } from "@/lib/agent-routing";
import { sendMessage } from "@/lib/actions/agent-coworker";
import { AgentPanelHeader } from "./AgentPanelHeader";
import { AgentMessageBubble } from "./AgentMessageBubble";
import { AgentMessageInput } from "./AgentMessageInput";

type Props = {
  threadId: string;
  initialMessages: AgentMessageRow[];
  userContext: UserContext;
  onClose: () => void;
  onDragStart: (e: React.MouseEvent) => void;
};

export function AgentCoworkerPanel({ threadId, initialMessages, userContext, onClose, onDragStart }: Props) {
  const pathname = usePathname();
  // Filter out old "X has joined" transition messages — they clutter the conversation
  const filtered = initialMessages.filter(
    (m) => !(m.role === "system" && m.content.endsWith("has joined the conversation")),
  );
  const [messages, setMessages] = useState<AgentMessageRow[]>(filtered);
  const [isPending, startTransition] = useTransition();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Resolve agent for current route
  const agent: AgentInfo = resolveAgentForRoute(pathname, userContext);

  // Auto-scroll to bottom when new messages appear
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleSend(content: string) {
    startTransition(async () => {
      const result = await sendMessage({
        threadId,
        content,
        routeContext: pathname,
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
      setMessages((prev) => [...prev, ...newMessages]);
    });
  }

  return (
    <>
      <AgentPanelHeader
        agent={agent}
        userContext={userContext}
        onSend={handleSend}
        onClose={onClose}
        onDragStart={onDragStart}
      />

      {/* Messages area */}
      <div style={{
        flex: 1,
        overflowY: "auto",
        padding: "12px",
      }}>
        {messages.length === 0 && (
          <div style={{
            textAlign: "center",
            color: "var(--dpf-muted)",
            fontSize: 12,
            padding: "40px 20px",
          }}>
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
        {isPending && (
          <div style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 2,
            marginBottom: 8,
          }}>
            <div style={{
              padding: "8px 16px",
              borderRadius: "12px 12px 12px 2px",
              fontSize: 13,
              background: "rgba(22, 22, 37, 0.8)",
              color: "var(--dpf-muted)",
            }}>
              <span className="animate-pulse">Thinking...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <AgentMessageInput onSend={handleSend} disabled={isPending} />
    </>
  );
}
