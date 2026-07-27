import {
  CANONICAL_AGENT_ID_TO_COWORKER_SLUG,
  resolveCanonicalAgentId,
} from "@dpf/db/agent-identity";

export const SELECTABLE_COWORKER_STATE = {
  status: "active",
  archived: false,
  lifecycleStage: "production",
} as const;

export function selectableCoworkerIdentityRefs(requestedRef: string): {
  canonicalAgentId: string;
  runtimeAgentId: string;
} {
  const canonicalAgentId = resolveCanonicalAgentId(requestedRef);
  return {
    canonicalAgentId,
    runtimeAgentId:
      CANONICAL_AGENT_ID_TO_COWORKER_SLUG[canonicalAgentId] ??
      canonicalAgentId,
  };
}
