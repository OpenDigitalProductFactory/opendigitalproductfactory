import { getToolGrantMapping, isToolAllowedByGrants } from "@/lib/tak/agent-grants";

export type TokenScope = "read" | "write" | "admin";

export type AssuranceReadinessReason =
  | "tool_not_mapped_to_grant"
  | "agent_grant_missing"
  | "runtime_tool_unavailable"
  | "insufficient_token_scope"
  | "adapter_not_approved";

export interface AssuranceReadinessInput {
  toolName: string;
  agentGrants: string[];
  runtimeTools: string[];
  tokenScope: TokenScope;
  requiredScope: TokenScope;
  adapterKey?: string;
  approvedAdapters?: string[];
}

export interface AssuranceReadinessResult {
  ready: boolean;
  reasons: AssuranceReadinessReason[];
}

const TOKEN_SCOPE_RANK: Record<TokenScope, number> = {
  read: 1,
  write: 2,
  admin: 3,
};

export function resolveAssuranceReadiness(input: AssuranceReadinessInput): AssuranceReadinessResult {
  const reasons: AssuranceReadinessReason[] = [];
  const grantMapping = getToolGrantMapping();

  if (!grantMapping[input.toolName]) {
    reasons.push("tool_not_mapped_to_grant");
  } else if (!isToolAllowedByGrants(input.toolName, input.agentGrants)) {
    reasons.push("agent_grant_missing");
  }

  if (!input.runtimeTools.includes(input.toolName)) {
    reasons.push("runtime_tool_unavailable");
  }

  if (TOKEN_SCOPE_RANK[input.tokenScope] < TOKEN_SCOPE_RANK[input.requiredScope]) {
    reasons.push("insufficient_token_scope");
  }

  if (input.adapterKey && !(input.approvedAdapters ?? []).includes(input.adapterKey)) {
    reasons.push("adapter_not_approved");
  }

  return { ready: reasons.length === 0, reasons };
}
