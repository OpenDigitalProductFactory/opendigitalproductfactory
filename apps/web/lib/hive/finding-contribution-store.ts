// BI-1281A164 — the IO half of contributing a finding that is not a code diff.
// The rules live in finding-contribution.ts and are pure.
//
// Order matters here and is deliberate: escalate FIRST, then record. If the
// order were reversed, a failed escalation would leave a proposal marked
// "contributed" that never left the install — which is worse than not
// contributing, because the local-only sweep would then stop reporting it and
// the finding would be invisible AND absent upstream.

import { createHash } from "node:crypto";

import {
  CONTRIBUTION_STATUS_CONTRIBUTED,
  planFindingContribution,
  readEscalationOutcome,
  type ContributableProposal,
  type ContributionResult,
  type EscalationOutcome,
} from "./finding-contribution";

export type FindingContributionDb = {
  improvementProposal: {
    findUnique(args: {
      where: { proposalId: string };
      select: Record<string, boolean>;
    }): Promise<Record<string, unknown> | null>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
  hiveContributionLedger: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
};

export type ContributeFindingInput = {
  db: FindingContributionDb;
  proposalId: string;
  /** Injected so the rules can be exercised without the upstream transport. */
  escalate: (input: { kind: "backlog"; id: string }) => Promise<EscalationOutcome>;
  /** The install's display pseudonym. Never a person; see identity-privacy. */
  pseudonym: () => Promise<string>;
};

const PROPOSAL_SELECT = {
  proposalId: true,
  title: true,
  description: true,
  contributionStatus: true,
  backlogItemId: true,
} as const;

export async function contributeFindingToHive(
  input: ContributeFindingInput,
): Promise<ContributionResult> {
  const row = await input.db.improvementProposal.findUnique({
    where: { proposalId: input.proposalId },
    select: { ...PROPOSAL_SELECT },
  });

  const proposal: ContributableProposal | null = row
    ? {
        proposalId: String(row.proposalId),
        title: String(row.title ?? ""),
        contributionStatus: String(row.contributionStatus ?? ""),
        backlogItemId: typeof row.backlogItemId === "string" ? row.backlogItemId : null,
      }
    : null;

  const plan = planFindingContribution(proposal, input.proposalId);
  if (!plan.eligible) {
    return { contributed: false, reason: plan.reason, detail: plan.detail };
  }

  const outcome = await input.escalate({ kind: "backlog", id: plan.backlogItemId });
  const verdict = readEscalationOutcome(outcome, {
    proposalId: plan.proposalId,
    title: proposal!.title,
  });
  if (!verdict.contributed) return verdict;

  // Recorded only after the escalation actually filed. The ledger row is the
  // audit trail `contribute_to_hive` itself never writes — it updates a
  // FeaturePack and leaves the ledger empty, which is why source and
  // improvement contributions have no history today.
  await input.db.hiveContributionLedger.create({
    data: {
      contributionType: "improvement",
      contributor: await input.pseudonym(),
      ruleKey: plan.proposalId,
      summary: verdict.ledgerSummary,
      payloadHash: createHash("sha256")
        .update(`${proposal!.title}\n${String(row?.description ?? "")}`)
        .digest("hex"),
      status: "submitted",
      redactionStatus: "redacted",
    },
  });

  // Guarded on the prior value so a concurrent contribution cannot double-flip,
  // and so this can never mark something contributed that was already marked by
  // someone else's send.
  await input.db.improvementProposal.updateMany({
    where: { proposalId: plan.proposalId, contributionStatus: { not: CONTRIBUTION_STATUS_CONTRIBUTED } },
    data: { contributionStatus: CONTRIBUTION_STATUS_CONTRIBUTED },
  });

  return verdict;
}
