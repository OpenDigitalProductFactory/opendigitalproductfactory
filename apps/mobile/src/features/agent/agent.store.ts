import { create } from "zustand";
import type { AgentMessage } from "@dpf/types";
import { api } from "@/src/lib/apiClient";

export interface LocalMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  agentId: string | null;
  routeContext: string | null;
  createdAt: string;
}

export interface AgentState {
  messages: LocalMessage[];
  isStreaming: boolean;
  currentAgent: string;
  isOpen: boolean;
  fetchThread: () => Promise<void>;
  sendMessage: (content: string, routeContext?: string) => Promise<void>;
  setAgent: (agentId: string) => void;
  togglePanel: () => void;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  messages: [],
  isStreaming: false,
  currentAgent: "workspace-guide",
  isOpen: false,

  fetchThread: async () => {
    try {
      const res = await api.agent.getThread();
      const mapped: LocalMessage[] = res.messages.map((m) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
        agentId: m.agentId ?? null,
        routeContext: m.routeContext ?? null,
        createdAt: m.createdAt,
      }));
      set({ messages: mapped });
    } catch {
      // Thread fetch is best-effort; keep existing messages
    }
  },

  sendMessage: async (content: string, routeContext?: string) => {
    const { currentAgent } = get();

    // Optimistically add user message
    const userMessage: LocalMessage = {
      id: `local-${Date.now()}`,
      role: "user",
      content,
      agentId: null,
      routeContext: routeContext ?? null,
      createdAt: new Date().toISOString(),
    };
    set((state) => ({
      messages: [...state.messages, userMessage],
      isStreaming: true,
    }));

    try {
      const res = await api.agent.sendMessage({
        content,
        agentId: currentAgent,
        routeContext,
      });

      // Replace the optimistic user message with the real one,
      // then fetch the full thread to get the assistant response
      set((state) => ({
        messages: state.messages.map((m) =>
          m.id === userMessage.id
            ? {
                id: res.id,
                role: res.role as "user" | "assistant",
                content: res.content,
                agentId: res.agentId ?? null,
                routeContext: res.routeContext ?? null,
                createdAt: res.createdAt,
              }
            : m,
        ),
      }));

      // Fetch the full thread to get the assistant's response
      await get().fetchThread();
    } catch {
      // Remove the optimistic message on failure
      set((state) => ({
        messages: state.messages.filter((m) => m.id !== userMessage.id),
      }));
    } finally {
      set({ isStreaming: false });
    }
  },

  setAgent: (agentId: string) => {
    set({ currentAgent: agentId });
  },

  togglePanel: () => {
    set((state) => ({ isOpen: !state.isOpen }));
  },
}));
