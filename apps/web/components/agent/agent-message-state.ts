import type { AgentMessageRow } from "@/lib/agent-coworker-types";

export type AgentDeliveryState = "sending" | "sent" | "failed";

export type AgentRenderableMessage = AgentMessageRow & {
  deliveryState?: AgentDeliveryState;
  retryContent?: string;
};

export function pendingCoworkerLabel(input: {
  agentName: string; clearing: boolean; status: string | null; tool: string | null;
  elapsedSeconds: number; acknowledged: boolean;
}): string {
  if (input.clearing) return "Clearing conversation";
  if (input.status) return input.status;
  if (input.tool) return `${input.agentName} is using ${input.tool.replace(/_/g, " ")}...`;
  // An acknowledgement or elapsed clock does not establish executor activity.
  return input.acknowledged ? "Your request is saved. Waiting for an update." : "Waiting for an update.";
}

/** An acknowledgement settles delivery, never the requested business outcome. */
export function acknowledgeRetainedMessage(messages: AgentRenderableMessage[], optimisticId: string, receipt: unknown): AgentRenderableMessage[] {
  const sent = messages.map(message => message.id === optimisticId ? { ...message, deliveryState: "sent" as const } : message);
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return sent;
  const row = receipt as Record<string, unknown>;
  if (row.role !== "system" || typeof row.id !== "string" || typeof row.content !== "string"
    || typeof row.createdAt !== "string" || sent.some(message => message.id === row.id)) return sent;
  return [...sent, { id: row.id, role: "system", content: row.content, createdAt: row.createdAt,
    agentId: typeof row.agentId === "string" ? row.agentId : null,
    routeContext: typeof row.routeContext === "string" ? row.routeContext : null }];
}

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
