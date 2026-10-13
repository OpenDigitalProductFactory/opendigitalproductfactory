import {
  resolveInitiativeReviewerRecovery,
  type InitiativeRecoveryCanonicalArtifact,
  type InitiativeRecoveryDispatchContext,
  type InitiativeReviewerRecovery,
} from "@/lib/tak/initiative-readiness-tool-grants";

import type { OwedAcceptanceOwnerResolver } from "./owed-acceptance";

// Production owner port for projectOwedAcceptance (BI-04140C98).
//
// The only role-to-coworker resolution on the platform is the grant-backed
// `resolveInitiativeReviewerRecovery`. Its acceptance lane is not marked
// independent, so it would pick the author when the author holds the grant
// and sorts first. A sweep exists because the author did not finish, so the
// author is removed from the candidate roster before resolution, and the next
// granted coworker is found instead of nobody (design §3.1).

type GrantRow = {
  grantKey: string;
  agent: { agentId: string; displayName: string; status: string; archived: boolean; lifecycleStage: string };
};

export type OwedAcceptanceOwnerDb = {
  agentToolGrant: { findMany(args: unknown): Promise<GrantRow[]> };
};

export function createOwedAcceptanceOwnerResolver(context: {
  db: OwedAcceptanceOwnerDb;
  dispatchContext: InitiativeRecoveryDispatchContext | null;
  canonicalArtifact?: InitiativeRecoveryCanonicalArtifact | null;
  planArtifact?: InitiativeRecoveryCanonicalArtifact | null;
  expectedCurrentBaselineId?: string | null;
  eligibleEvidenceActivityIds?: readonly string[];
}): (...args: Parameters<OwedAcceptanceOwnerResolver>) => Promise<InitiativeReviewerRecovery> {
  return ({ decision, authorAgentId, excludedAgentIds }) => {
    // BI-099A0BA3 (M1): the author and every other delivery actor leave the roster.
    const excluded = new Set([...(authorAgentId ? [authorAgentId] : []), ...(excludedAgentIds ?? [])]);
    return resolveInitiativeReviewerRecovery({
    decision,
    currentAgentId: authorAgentId,
    db: {
      agentToolGrant: {
        findMany: async (args) => {
          const rows = await context.db.agentToolGrant.findMany(args);
          return rows.filter((row) => !excluded.has(row.agent.agentId));
        },
      },
    },
    dispatchContext: context.dispatchContext,
    canonicalArtifact: context.canonicalArtifact ?? null,
    ...(context.planArtifact !== undefined ? { planArtifact: context.planArtifact } : {}),
    expectedCurrentBaselineId: context.expectedCurrentBaselineId ?? null,
    ...(context.eligibleEvidenceActivityIds ? { eligibleEvidenceActivityIds: context.eligibleEvidenceActivityIds } : {}),
    });
  };
}
