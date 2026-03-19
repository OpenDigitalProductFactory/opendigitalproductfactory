import type { DpfClient } from "../client";
import type { AgentThread, AgentMessage, AgentActionProposal } from "@dpf/types";

export interface SendMessageRequest {
  content: string;
  agentId?: string;
  routeContext?: string;
}

export interface ThreadResponse {
  threadId: string;
  messages: Array<
    Pick<
      AgentMessage,
      "id" | "role" | "content" | "agentId" | "routeContext"
    > & { createdAt: string }
  >;
}

export interface ProposalsResponse {
  proposals: Array<
    Pick<
      AgentActionProposal,
      "id" | "proposalId" | "actionType" | "parameters" | "status"
    > & {
      createdAt: string;
      message: {
        id: string;
        role: string;
        content: string;
        agentId: string | null;
        routeContext: string | null;
        createdAt: string;
      } | null;
    }
  >;
}

export function agentEndpoints(client: DpfClient) {
  return {
    getThread: () => client.get<ThreadResponse>("/api/v1/agent/thread"),

    sendMessage: (input: SendMessageRequest) =>
      client.post<
        Pick<
          AgentMessage,
          "id" | "role" | "content" | "agentId" | "routeContext"
        > & { createdAt: string; threadId: string }
      >("/api/v1/agent/message", input),

    getProposals: () =>
      client.get<ProposalsResponse>("/api/v1/agent/proposals"),

    // Note: stream endpoint returns SSE, not JSON — consumers should use
    // EventSource or fetch with ReadableStream directly. This helper
    // returns the stream URL for convenience.
    streamUrl: () => "/api/v1/agent/stream",
  };
}
