import type { AgentMessageRow } from "@/lib/agent-coworker-types";

export type AgentDeliveryState = "sending" | "sent" | "failed";

export type AgentRenderableMessage = AgentMessageRow & {
  deliveryState?: AgentDeliveryState;
  retryContent?: string;
};

export function createOptimisticUserMessage(
  content: string,
  routeContext: string,
  now: Date = new Date(),
): AgentRenderableMessage {
  const iso = now.toISOString();
  const optimisticId = `local-user-${now.getTime()}`;
  return {
    id: optimisticId,
    role: "user",
    content,
    agentId: null,
    routeContext,
    createdAt: iso,
    deliveryState: "sending",
    retryContent: content,
  };
}

export function failOptimisticMessage(message: AgentRenderableMessage): AgentRenderableMessage {
  return {
    ...message,
    deliveryState: "failed",
    retryContent: message.retryContent ?? message.content,
  };
}

export function retryOptimisticMessage(message: AgentRenderableMessage): AgentRenderableMessage {
  return {
    ...message,
    deliveryState: "sending",
    retryContent: message.retryContent ?? message.content,
  };
}

export function reconcileOptimisticMessage(
  message: AgentRenderableMessage,
  confirmed: AgentMessageRow,
): AgentRenderableMessage {
  return {
    ...confirmed,
    deliveryState: "sent",
    retryContent: message.retryContent ?? confirmed.content,
  };
}
