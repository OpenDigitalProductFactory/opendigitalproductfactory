// BI-1281A164 / EP-HIVE-HARVEST — make step 4 of `dpf-route-learning-to-commons`
// reachable for a finding that is not a code diff.
//
// THE MEASURED PROBLEM. That skill's step 4 is the one that turns install-local
// knowledge into platform-wide knowledge: "Skipping it leaves the learning
// robust on one install only." It names `contribute_to_hive`. That handler
// resolves an active FeatureBuild and hard-fails "No active build" before doing
// anything else, then works from the build's `diffPatch`. An external session —
// Claude Code, Codex, Grok — holding a durable finding has no build and no
// diff, so the step cannot execute at all. The skill's own worked example
// returns "No active build".
//
// That is the structural reason an install explicitly configured to contribute
// accumulated 239 improvement proposals and contributed none. It was never a
// discipline problem.
//
// WHAT THIS ADDS. A finding already travels further than it looks:
// `propose_improvement` writes an ImprovementProposal AND auto-files a
// BacklogItem, back-linking `backlogItemId`. `escalateToUpstreamIssue` already
// escalates `kind: "backlog"` with no build, no diff and no GitHub token (the
// relay path), redacting through the same payload builder the feedback path
// uses. Both halves exist; nothing joined them, and nothing moved
// `contributionStatus` off its "local" default afterwards.
//
// So this is a join, not an engine. It reuses the existing escalation, and then
// records what that escalation MEANT for the finding — which is the part that
// makes the local-only sweep (local-only-knowledge-sweep.ts) stop reporting it.

/** Set by `propose_improvement`; only "contributed" means it left the install. */
export const CONTRIBUTION_STATUS_LOCAL = "local";
export const CONTRIBUTION_STATUS_CONTRIBUTED = "contributed";

export const CONTRIBUTION_REFUSALS = [
  "not-found",
  "already-contributed",
  "no-backlog-item",
  "escalation-refused",
] as const;
export type ContributionRefusal = (typeof CONTRIBUTION_REFUSALS)[number];

/** The proposal columns this module reasons over. Nothing else is read. */
export type ContributableProposal = {
  proposalId: string;
  title: string;
  contributionStatus: string;
  /** The BacklogItem row id (cuid) `propose_improvement` back-linked, if any. */
  backlogItemId: string | null;
};

export type ContributionPlan =
  | { eligible: true; proposalId: string; backlogItemId: string }
  | { eligible: false; reason: ContributionRefusal; detail: string };

/**
 * Whether this finding MAY be contributed, and what it would escalate. Pure.
 *
 * `already-contributed` is a refusal rather than a no-op on purpose: a second
 * send would file a duplicate upstream under the install's pseudonym, and the
 * caller should know its earlier call already worked rather than assume the
 * first one failed silently.
 */
export function planFindingContribution(
  proposal: ContributableProposal | null,
  proposalId: string,
): ContributionPlan {
  if (!proposal) {
    return {
      eligible: false,
      reason: "not-found",
      detail: `No improvement proposal ${JSON.stringify(proposalId)} on this install.`,
    };
  }

  if (proposal.contributionStatus === CONTRIBUTION_STATUS_CONTRIBUTED) {
    return {
      eligible: false,
      reason: "already-contributed",
      detail:
        `${proposal.proposalId} has already been contributed. Nothing was sent again — a second send would `
        + "file a duplicate upstream under this install's pseudonym.",
    };
  }

  if (!proposal.backlogItemId) {
    return {
      eligible: false,
      reason: "no-backlog-item",
      detail:
        `${proposal.proposalId} carries no backlog item, so there is nothing to escalate. `
        + "`propose_improvement` files one for every proposal except a low-severity reference-doc "
        + "note, which is suppressed deliberately and batched by the canonical improvement digest "
        + "instead. If this finding is durable, re-raise it at a severity that files an item.",
    };
  }

  return { eligible: true, proposalId: proposal.proposalId, backlogItemId: proposal.backlogItemId };
}

/** What the existing escalation reports back. Mirrored so the rules stay pure. */
export type EscalationOutcome =
  | { status: "filed"; issueNumber: number | null; url: string | null }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

export type ContributionResult =
  | {
      contributed: true;
      proposalId: string;
      issueNumber: number | null;
      url: string | null;
      ledgerSummary: string;
    }
  | { contributed: false; reason: ContributionRefusal; detail: string };

/**
 * Read an escalation outcome as a contribution verdict.
 *
 * A `skipped` escalation is NOT a success. The install may be private, the
 * upstream remote may be unset, or the item may already be upstream — each is a
 * different fact and each is reported verbatim rather than flattened into a
 * failure, because "this install keeps everything local" is a correct answer
 * and a contributor should not be told its finding failed.
 */
export function readEscalationOutcome(
  outcome: EscalationOutcome,
  proposal: { proposalId: string; title: string },
): ContributionResult {
  if (outcome.status === "filed") {
    return {
      contributed: true,
      proposalId: proposal.proposalId,
      issueNumber: outcome.issueNumber,
      url: outcome.url,
      ledgerSummary: buildLedgerSummary(proposal, outcome),
    };
  }
  const detail =
    outcome.status === "skipped"
      ? `Not contributed: ${outcome.reason}.`
      : `Contribution failed: ${outcome.error}.`;
  return { contributed: false, reason: "escalation-refused", detail };
}

export function buildLedgerSummary(
  proposal: { proposalId: string; title: string },
  outcome: Extract<EscalationOutcome, { status: "filed" }>,
): string {
  const where = outcome.url ?? (outcome.issueNumber != null ? `issue #${outcome.issueNumber}` : "upstream");
  return `Finding contributed to the hive: ${proposal.proposalId} — ${proposal.title} → ${where}`;
}
