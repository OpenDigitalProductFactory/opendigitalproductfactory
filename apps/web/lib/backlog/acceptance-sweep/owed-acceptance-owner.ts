import {
  resolveInitiativeReviewerRecovery,
  type InitiativeRecoveryCanonicalArtifact,
  type InitiativeRecoveryDispatchContext,
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
  expectedCurrentBaselineId?: string | null;
  eligibleEvidenceActivityIds?: readonly string[];
}): OwedAcceptanceOwnerResolver {
  return ({ decision, authorAgentId }) => resolveInitiativeReviewerRecovery({
    decision,
    currentAgentId: authorAgentId,
    db: {
      agentToolGrant: {
        findMany: async (args) => {
          const rows = await context.db.agentToolGrant.findMany(args);
          return authorAgentId ? rows.filter((row) => row.agent.agentId !== authorAgentId) : rows;
        },
      },
    },
    dispatchContext: context.dispatchContext,
    canonicalArtifact: context.canonicalArtifact ?? null,
    expectedCurrentBaselineId: context.expectedCurrentBaselineId ?? null,
    ...(context.eligibleEvidenceActivityIds ? { eligibleEvidenceActivityIds: context.eligibleEvidenceActivityIds } : {}),
  });
}
