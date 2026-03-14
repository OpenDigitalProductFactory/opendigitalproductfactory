import type { CapabilityKey } from "@/lib/permissions";

/** Serialized message for client/server boundary. */
export type AgentMessageRow = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  agentId: string | null;
  routeContext: string | null;
  createdAt: string; // ISO string via .toISOString()
};

/** Resolved agent info returned by resolveAgentForRoute. */
export type AgentInfo = {
  agentId: string;
  agentName: string;
  agentDescription: string;
  canAssist: boolean;
};

/** Entry in the route-to-agent map. */
export type RouteAgentEntry = {
  agentId: string;
  agentName: string;
  agentDescription: string;
  capability: CapabilityKey | null;
};

/** Max message content length (chars). */
export const MAX_MESSAGE_LENGTH = 2000;

/** Validate message input (pure function, usable from tests and server actions). */
export function validateMessageInput(input: {
  content: string;
  routeContext: string;
}): string | null {
  const trimmed = input.content.trim();
  if (!trimmed) return "Message content cannot be empty";
  if (trimmed.length > MAX_MESSAGE_LENGTH) return `Message cannot exceed ${MAX_MESSAGE_LENGTH} characters`;
  if (!input.routeContext) return "Route context is required";
  return null;
}
