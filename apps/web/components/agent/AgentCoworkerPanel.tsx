"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import type { AgentMessageRow, AgentInfo } from "@/lib/agent-coworker-types";
import type { UserContext } from "@/lib/permissions";
import { resolveAgentForRoute, AGENT_NAME_MAP } from "@/lib/agent-routing";
import { sendMessage, recordAgentTransition } from "@/lib/actions/agent-coworker";
import { AgentPanelHeader } from "./AgentPanelHeader";
import { AgentMessageBubble } from "./AgentMessageBubble";
import { AgentMessageInput } from "./AgentMessageInput";

type Props = {
  threadId: string;
  initialMessages: AgentMessageRow[];
  userContext: UserContext;
};

const PANEL_W = 380;
const PANEL_H = 480;
const EDGE_GAP = 16;
const LS_KEY_OPEN = "agent-panel-open";
const LS_KEY_POS = "agent-panel-position";

function loadPosition(): { x: number; y: number } {
  try {
    const raw = localStorage.getItem(LS_KEY_POS);
    if (raw) {
      const parsed = JSON.parse(raw) as { x: number; y: number };
      if (typeof parsed.x === "number" && typeof parsed.y === "number") return parsed;
    }
  } catch { /* ignore */ }
  return {
    x: typeof window !== "undefined" ? window.innerWidth - PANEL_W - EDGE_GAP : EDGE_GAP,
    y: typeof window !== "undefined" ? window.innerHeight - PANEL_H - EDGE_GAP : EDGE_GAP,
  };
}

function loadOpen(): boolean {
  try {
    return localStorage.getItem(LS_KEY_OPEN) === "true";
  } catch {
    return false;
  }
}

export function AgentCoworkerPanel({ threadId, initialMessages, userContext }: Props) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [messages, setMessages] = useState<AgentMessageRow[]>(initialMessages);
  const [isPending, startTransition] = useTransition();
  const [lastAgentId, setLastAgentId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);
  const positionRef = useRef(position);

  // Hydrate from localStorage after mount
  useEffect(() => {
    setIsOpen(loadOpen());
    const pos = loadPosition();
    positionRef.current = pos;
    setPosition(pos);
  }, []);

  // Listen for toggle event from Header Agent button
  useEffect(() => {
    function handleToggle() {
      setIsOpen((prev) => {
        const next = !prev;
        localStorage.setItem(LS_KEY_OPEN, String(next));
        return next;
      });
    }
    document.addEventListener("toggle-agent-panel", handleToggle);
    return () => document.removeEventListener("toggle-agent-panel", handleToggle);
  }, []);

  // Resolve agent for current route
  const agent: AgentInfo = resolveAgentForRoute(pathname, userContext);

  // Agent transition — persist system message when agent changes
  useEffect(() => {
    if (lastAgentId === null) {
      setLastAgentId(agent.agentId);
      return;
    }
    if (agent.agentId !== lastAgentId) {
      setLastAgentId(agent.agentId);
      // Optimistic: show immediately
      const optimisticMsg: AgentMessageRow = {
        id: `system-${Date.now()}`,
        role: "system",
        content: `${agent.agentName} has joined the conversation`,
        agentId: agent.agentId,
        routeContext: pathname,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimisticMsg]);
      // Persist to DB (fire-and-forget — optimistic msg is already shown)
      void recordAgentTransition({
        threadId,
        agentId: agent.agentId,
        agentName: agent.agentName,
        routeContext: pathname,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- agentName is derived from agentId
  }, [agent.agentId, pathname, lastAgentId, threadId]);

  // Auto-scroll to bottom when new messages appear
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ─── Drag handling ──────────────────────────────────────────────────────

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
      const newPos = {
        x: dragRef.current.startPosX + dx,
        y: dragRef.current.startPosY + dy,
      };
      positionRef.current = newPos;
      setPosition(newPos);
      localStorage.setItem(LS_KEY_POS, JSON.stringify(newPos));
    }

    function onMouseUp() {
      dragRef.current = null;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, []);

  // ─── Send message ───────────────────────────────────────────────────────

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
      setMessages((prev) => [...prev, result.userMessage, result.agentMessage]);
    });
  }

  function handleClose() {
    setIsOpen(false);
    localStorage.setItem(LS_KEY_OPEN, "false");
  }

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        left: position.x,
        top: position.y,
        width: PANEL_W,
        height: PANEL_H,
        zIndex: 50,
        display: "flex",
        flexDirection: "column",
        background: "var(--dpf-surface-1)",
        border: "1px solid var(--dpf-border)",
        borderRadius: 12,
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        overflow: "hidden",
      }}
    >
      <AgentPanelHeader
        agent={agent}
        onMouseDown={handleDragStart}
        onClose={handleClose}
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
        <div ref={messagesEndRef} />
      </div>

      <AgentMessageInput onSend={handleSend} disabled={isPending} />
    </div>
  );
}
