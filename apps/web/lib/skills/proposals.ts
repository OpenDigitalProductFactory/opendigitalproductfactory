// Skill proposal lifecycle (Slice 3 of the governed Hermes learning loop).
//
// Reuses ImprovementProposal as the proposal envelope; mirrors PromptRevision
// for SkillRevision. Approval and rollback run inside a Prisma transaction so
// the row, the snapshot, and the new SkillDefinition.skillMdContent all move
// together — partial state cannot persist on a transient DB failure.

import { randomUUID } from "crypto";

import { prisma } from "@dpf/db";

const PROPOSAL_ID_PREFIX = "IP-SKL";
const REVISION_ID_PREFIX = "SREV";

function makeProposalId(): string {
  return `${PROPOSAL_ID_PREFIX}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function makeRevisionId(): string {
  return `${REVISION_ID_PREFIX}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

import { writeSkillSeed, type SkillSeedWriteResult } from "./seed-writeback";
import { emitSeedPullRequest, type SeedPullRequestResult } from "./seed-pull-request";

export type SubmitSkillImprovementProposalInput = {
  /** SkillDefinition.skillId (business id). */
  skillId: string;
  /** Full proposed SKILL.md content (no diff format — store the target body). */
  proposedContent: string;
  /** Short title summarising the proposal. */
  title: string;
  /** Long-form description / rationale. */
  description: string;
  /** ImprovementProposal severity. */
  severity?: "low" | "medium" | "high" | "critical";
  /** User identity submitting the proposal (existing ImprovementProposal contract). */
  submittedById: string;
  /** Agent identity (coworker that authored the proposal). */
  agentId: string;
  /** Route context where the proposal was raised. */
  routeContext: string;
  /** Optional thread linkage for evidence. */
  threadId?: string | null;
  /** Optional conversation excerpt for the human reviewer. */
  conversationExcerpt?: string | null;
  /** Optional one-liner describing the friction this proposal addresses. */
  observedFriction?: string | null;
};

export type SubmitSkillImprovementProposalResult = {
  proposalId: string;
};

/**
 * Persist a new ImprovementProposal(category="skill", targetSkillId=...) row.
 * The full proposed content is stored in `conversationExcerpt` because the
 * existing schema has no diff-shaped column — the spec defers a dedicated
 * `proposedDiffJson` until the text fields prove insufficient. Approval
 * reads it back from the same column.
 */
export async function submitSkillImprovementProposal(
  input: SubmitSkillImprovementProposalInput,
): Promise<SubmitSkillImprovementProposalResult> {
  const skill = await prisma.skillDefinition.findUnique({
    where: { skillId: input.skillId },
    select: { skillId: true },
  });
  if (!skill) {
    throw new Error(`[skill-proposals] unknown skillId: ${input.skillId}`);
  }
  if (typeof input.proposedContent !== "string" || input.proposedContent.length === 0) {
    throw new Error("[skill-proposals] proposedContent must be a non-empty string");
  }

  const proposalId = makeProposalId();
  await prisma.improvementProposal.create({
    data: {
      proposalId,
      title: input.title.slice(0, 200),
      description: input.description,
      category: "skill",
      severity: input.severity ?? "medium",
      submittedById: input.submittedById,
      agentId: input.agentId,
      routeContext: input.routeContext,
      threadId: input.threadId ?? null,
      conversationExcerpt: input.proposedContent,
      observedFriction: input.observedFriction ?? null,
      targetSkillId: input.skillId,
      status: "proposed",
    },
  });

  return { proposalId };
}

export type ApproveSkillImprovementProposalInput = {
  /** DCO identity for the emitted seed PR; publishBranchCommit requires it. */
  reviewerName?: string;
  reviewerEmail?: string;
  proposalId: string;
  reviewerId: string;
  /** Optional override of the approval reason recorded on the revision. */
  changeReason?: string;
};

export type ApproveSkillImprovementProposalResult = {
  /**
   * Whether the approved body reached the SEED FILE — the authoritative copy
   * (DI-36D36FEBF4BA). Only `status: "written"` means the approval is durable;
   * anything else will be reverted by the next reseed, and callers MUST say so
   * rather than reporting a bare success.
   */
  propagation: SkillSeedWriteResult;
  /**
   * Whether the approved body was published as a reviewable pull request
   * against the seed file (BI-5798BBA3 phase 2b, DI-36D36FEBF4BA). On a
   * production install this — not the local file write — is what makes an
   * approval durable, because DPF_REPO_ROOT there is the deployment clone.
   */
  seedPullRequest: SeedPullRequestResult;
  proposalId: string;
  skillId: string;
  snapshotRevisionId: string;
  appliedRevisionId: string;
  newVersion: number;
};

/**
 * Approve a skill improvement proposal. Atomic — all writes happen inside one
 * Prisma transaction. The DB never mutates SkillDefinition.skillMdContent in
 * place: a snapshot revision is written FIRST (capturing the pre-approval
 * body), then the applied revision and the SkillDefinition update happen
 * together. Rollback simply restores from any prior revision.
 */
export async function approveSkillImprovementProposal(
  input: ApproveSkillImprovementProposalInput,
): Promise<ApproveSkillImprovementProposalResult> {
  const applied = await prisma.$transaction(async (tx) => {
    const proposal = await tx.improvementProposal.findUnique({
      where: { proposalId: input.proposalId },
    });
    if (!proposal) {
      throw new Error(`[skill-proposals] proposal not found: ${input.proposalId}`);
    }
    if (proposal.category !== "skill") {
      throw new Error(
        `[skill-proposals] proposal ${input.proposalId} is not category="skill"`,
      );
    }
    if (proposal.status !== "proposed") {
      throw new Error(
        `[skill-proposals] proposal ${input.proposalId} is not in status="proposed" (was ${proposal.status})`,
      );
    }
    if (!proposal.targetSkillId) {
      throw new Error(
        `[skill-proposals] proposal ${input.proposalId} has no targetSkillId`,
      );
    }
    const proposedContent = proposal.conversationExcerpt;
    if (!proposedContent) {
      throw new Error(
        `[skill-proposals] proposal ${input.proposalId} has no proposed content`,
      );
    }

    const skill = await tx.skillDefinition.findUnique({
      where: { skillId: proposal.targetSkillId },
      select: { skillId: true, category: true, skillMdContent: true },
    });
    if (!skill) {
      throw new Error(
        `[skill-proposals] proposal targets unknown skill: ${proposal.targetSkillId}`,
      );
    }

    const latest = await tx.skillRevision.findFirst({
      where: { skillId: skill.skillId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const baseVersion = latest?.version ?? 0;
    const snapshotVersion = baseVersion + 1;
    const appliedVersion = baseVersion + 2;

    const snapshotRevisionId = makeRevisionId();
    await tx.skillRevision.create({
      data: {
        revisionId: snapshotRevisionId,
        skillId: skill.skillId,
        version: snapshotVersion,
        content: skill.skillMdContent,
        changeReason: "pre-approval snapshot",
        changedBy: input.reviewerId,
      },
    });

    const appliedRevisionId = makeRevisionId();
    await tx.skillRevision.create({
      data: {
        revisionId: appliedRevisionId,
        skillId: skill.skillId,
        version: appliedVersion,
        content: proposedContent,
        changeReason: input.changeReason ?? `approved proposal ${proposal.proposalId}`,
        changedBy: input.reviewerId,
        proposalId: proposal.proposalId,
      },
    });

    await tx.skillDefinition.update({
      where: { skillId: skill.skillId },
      data: { skillMdContent: proposedContent },
    });

    const now = new Date();
    await tx.improvementProposal.update({
      where: { proposalId: proposal.proposalId },
      data: {
        status: "reviewed",
        reviewedById: input.reviewerId,
        reviewedAt: now,
        verifiedAt: now,
      },
    });

    return {
      proposalId: proposal.proposalId,
      skillId: skill.skillId,
      category: skill.category,
      approvedContent: proposedContent,
      previousContent: skill.skillMdContent,
      snapshotRevisionId,
      appliedRevisionId,
      newVersion: appliedVersion,
    };
  });

  // POST-COMMIT, deliberately. The approval is already durable in the DB; a
  // filesystem failure here must be reported, never allowed to unwind it.
  // Writing the seed is what stops the next reseed reverting the approval
  // (BI-5798BBA3), because the seed file is the authoritative copy.
  const propagation = writeSkillSeed(
    applied.category,
    applied.skillId,
    applied.approvedContent,
  );

  // Then publish it for review. This runs over the GitHub API and touches no
  // working tree, so it is safe on a production install where DPF_REPO_ROOT is
  // the deployment clone. Also best-effort: a GitHub failure is reported, never
  // allowed to unwind an approval that already committed.
  const seedPullRequest = await emitSeedPullRequest({
    skillId: applied.skillId,
    seedPath: propagation.path ?? seedPathFor(applied.category, applied.skillId),
    before: applied.previousContent,
    after: applied.approvedContent,
    proposalId: applied.proposalId,
    reviewerName: input.reviewerName ?? "DPF Platform",
    reviewerEmail: input.reviewerEmail ?? "noreply@dpf.local",
    ...(await resolveRepoCoordinates()),
  });

  return {
    proposalId: applied.proposalId,
    skillId: applied.skillId,
    snapshotRevisionId: applied.snapshotRevisionId,
    appliedRevisionId: applied.appliedRevisionId,
    newVersion: applied.newVersion,
    propagation,
    seedPullRequest,
  };
}

/** The seed path to name when no file was found on disk to write. */
function seedPathFor(category: string, skillId: string): string {
  return `packages/dpf-skill-pack/skills/${skillId}/SKILL.md` || category;
}

/** Owner/repo from the git remote, so the PR targets this platform's own repo. */
async function resolveRepoCoordinates(): Promise<{ repoOwner: string | null; repoRepo: string | null }> {
  try {
    const { getRemoteUrl } = await import("@/lib/git-utils");
    const remoteUrl = await getRemoteUrl();
    const match = remoteUrl?.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    if (match) return { repoOwner: match[1]!, repoRepo: match[2]! };
  } catch {
    // git may not be available; the caller reports no-repo rather than throwing.
  }
  return { repoOwner: null, repoRepo: null };
}

export type RejectSkillImprovementProposalInput = {
  proposalId: string;
  reviewerId: string;
  rejectionReason: string;
};

export type RejectSkillImprovementProposalResult = {
  proposalId: string;
};

/** Mark a skill proposal rejected. No revision is created. */
export async function rejectSkillImprovementProposal(
  input: RejectSkillImprovementProposalInput,
): Promise<RejectSkillImprovementProposalResult> {
  const proposal = await prisma.improvementProposal.findUnique({
    where: { proposalId: input.proposalId },
    select: { category: true, status: true },
  });
  if (!proposal) {
    throw new Error(`[skill-proposals] proposal not found: ${input.proposalId}`);
  }
  if (proposal.category !== "skill") {
    throw new Error(
      `[skill-proposals] proposal ${input.proposalId} is not category="skill"`,
    );
  }
  if (proposal.status !== "proposed") {
    throw new Error(
      `[skill-proposals] proposal ${input.proposalId} is not in status="proposed" (was ${proposal.status})`,
    );
  }
  if (!input.rejectionReason || input.rejectionReason.trim().length === 0) {
    throw new Error("[skill-proposals] rejectionReason is required");
  }

  await prisma.improvementProposal.update({
    where: { proposalId: input.proposalId },
    data: {
      status: "rejected",
      reviewedById: input.reviewerId,
      reviewedAt: new Date(),
      rejectionReason: input.rejectionReason,
    },
  });

  return { proposalId: input.proposalId };
}

export type RollbackSkillToRevisionInput = {
  skillId: string;
  /** Version number on SkillRevision the operator wants to restore. */
  targetVersion: number;
  reviewerId: string;
};

export type RollbackSkillToRevisionResult = {
  skillId: string;
  newRevisionId: string;
  newVersion: number;
  restoredFromVersion: number;
};

/**
 * Restore a skill's content from a prior revision. Always writes a NEW
 * revision (never mutates an existing one); the new row's content is a
 * direct copy of the target revision's content, and its changeReason
 * records the rollback intent.
 */
export async function rollbackSkillToRevision(
  input: RollbackSkillToRevisionInput,
): Promise<RollbackSkillToRevisionResult> {
  return prisma.$transaction(async (tx) => {
    const target = await tx.skillRevision.findUnique({
      where: {
        skillId_version: { skillId: input.skillId, version: input.targetVersion },
      },
      select: { content: true, version: true },
    });
    if (!target) {
      throw new Error(
        `[skill-proposals] revision not found: ${input.skillId} v${input.targetVersion}`,
      );
    }

    const latest = await tx.skillRevision.findFirst({
      where: { skillId: input.skillId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const newVersion = (latest?.version ?? 0) + 1;

    const newRevisionId = makeRevisionId();
    await tx.skillRevision.create({
      data: {
        revisionId: newRevisionId,
        skillId: input.skillId,
        version: newVersion,
        content: target.content,
        changeReason: `rollback to v${target.version}`,
        changedBy: input.reviewerId,
      },
    });

    await tx.skillDefinition.update({
      where: { skillId: input.skillId },
      data: { skillMdContent: target.content },
    });

    return {
      skillId: input.skillId,
      newRevisionId,
      newVersion,
      restoredFromVersion: target.version,
    };
  });
}

export type SkillRevisionRow = {
  revisionId: string;
  version: number;
  changeReason: string | null;
  changedBy: string | null;
  proposalId: string | null;
  createdAt: string;
};

export async function listSkillRevisions(
  skillId: string,
): Promise<SkillRevisionRow[]> {
  const rows = await prisma.skillRevision.findMany({
    where: { skillId },
    orderBy: { version: "desc" },
    select: {
      revisionId: true,
      version: true,
      changeReason: true,
      changedBy: true,
      proposalId: true,
      createdAt: true,
    },
  });
  return rows.map((r) => ({
    revisionId: r.revisionId,
    version: r.version,
    changeReason: r.changeReason,
    changedBy: r.changedBy,
    proposalId: r.proposalId,
    createdAt: r.createdAt.toISOString(),
  }));
}

export type SkillProposalRow = {
  proposalId: string;
  title: string;
  description: string;
  severity: string;
  submittedById: string;
  agentId: string;
  threadId: string | null;
  observedFriction: string | null;
  proposedContent: string;
  status: string;
  reviewedById: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
};

/**
 * Fetch all proposals targeting a given skill, newest first. Includes
 * proposed/reviewed/rejected so the operator can see the full lifecycle in
 * the panel.
 */
export async function listSkillProposals(
  skillId: string,
): Promise<SkillProposalRow[]> {
  const rows = await prisma.improvementProposal.findMany({
    where: { category: "skill", targetSkillId: skillId },
    orderBy: { createdAt: "desc" },
    select: {
      proposalId: true,
      title: true,
      description: true,
      severity: true,
      submittedById: true,
      agentId: true,
      threadId: true,
      observedFriction: true,
      conversationExcerpt: true,
      status: true,
      reviewedById: true,
      reviewedAt: true,
      rejectionReason: true,
      createdAt: true,
    },
  });
  return rows.map((r) => ({
    proposalId: r.proposalId,
    title: r.title,
    description: r.description,
    severity: r.severity,
    submittedById: r.submittedById,
    agentId: r.agentId,
    threadId: r.threadId,
    observedFriction: r.observedFriction,
    proposedContent: r.conversationExcerpt ?? "",
    status: r.status,
    reviewedById: r.reviewedById,
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
    rejectionReason: r.rejectionReason,
    createdAt: r.createdAt.toISOString(),
  }));
}

