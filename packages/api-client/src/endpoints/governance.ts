import type { DpfClient } from "../client";
import type {
  AgentActionProposal,
  AuthorizationDecisionLog,
  PaginatedResponse,
  ApprovalDecisionRequest,
} from "@dpf/types";

export function governanceEndpoints(client: DpfClient) {
  return {
    listApprovals: (params?: { cursor?: string; limit?: number }) => {
      const qs = new URLSearchParams();
      if (params?.cursor) qs.set("cursor", params.cursor);
      if (params?.limit) qs.set("limit", String(params.limit));
      const query = qs.toString();
      return client.get<PaginatedResponse<AgentActionProposal>>(
        `/api/v1/governance/approvals${query ? `?${query}` : ""}`,
      );
    },

    decide: (id: string, input: ApprovalDecisionRequest) =>
      client.post<AgentActionProposal>(
        `/api/v1/governance/approvals/${id}`,
        input,
      ),

    listDecisions: (params?: { cursor?: string; limit?: number }) => {
      const qs = new URLSearchParams();
      if (params?.cursor) qs.set("cursor", params.cursor);
      if (params?.limit) qs.set("limit", String(params.limit));
      const query = qs.toString();
      return client.get<PaginatedResponse<AuthorizationDecisionLog>>(
        `/api/v1/governance/decisions${query ? `?${query}` : ""}`,
      );
    },
  };
}
