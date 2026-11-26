// apps/web/lib/skills/seed-writeback.ts
//
// Propagate an approved skill body to the SEED FILE, which is the authoritative
// copy (decision DI-36D36FEBF4BA, `file-authoritative-pr`).
//
// Why this exists: approving a skill proposal used to update only
// SkillDefinition.skillMdContent. The next reseed rewrites that column from the
// seed file, so an approval survived only until the next seed run — observed
// live on 2026-08-23, where an approved body was restored to its pre-approval
// snapshot roughly three hours later while the proposal still read "reviewed".
// Writing the seed is what makes an approval durable.
//
// This module deliberately does NOT create the seed file when none exists.
// Inventing a path would guess which corpus a skill belongs to and could seed a
// file the loader never reads; the caller surfaces `no-seed-file` instead so the
// gap stays visible rather than being papered over.

import { existsSync, writeFileSync } from "fs";

import { getErrorMessage } from "@/lib/shared/get-error-message";
import type { AppliedSkillRevision } from "@/lib/self-upgrade/source-writer-actuator";

import { resolveSeedPathCandidates } from "./seed-parity";

/**
 * Outcome of a seed write. ONLY `written` means the approval reached the copy
 * that ships; every other status leaves it unpropagated and revertible by the
 * next reseed, and callers must say so rather than reporting success.
 */
export type SkillSeedWriteStatus =
  | "written"
  | "repo-unavailable"
  | "no-seed-file"
  | "write-failed";

export type SkillSeedWriteResult = {
  status: SkillSeedWriteStatus;
  /** The seed file written, or the path that would have been written. */
  path: string | null;
  /** Human-readable detail when the write did not happen. */
  reason: string | null;
};

function repoRoot(): string {
  return process.env.DPF_REPO_ROOT ?? `${process.cwd()}/../..`;
}

/**
 * Write an approved skill body to its seed file. Best-effort and non-throwing:
 * the caller has already committed the DB transaction, so a filesystem failure
 * must be reported, never allowed to unwind an approval that already happened.
 */
export function writeSkillSeed(
  category: string,
  skillId: string,
  content: string,
): SkillSeedWriteResult {
  if (!existsSync(/*turbopackIgnore: true*/ repoRoot())) {
    return {
      status: "repo-unavailable",
      path: null,
      reason: "No repository checkout is reachable from this app instance.",
    };
  }

  const candidates = resolveSeedPathCandidates(category, skillId);
  const target = candidates.find((candidate) => existsSync(candidate)) ?? null;
  if (!target) {
    return {
      status: "no-seed-file",
      path: null,
      reason: `No seed file exists for this skill. Looked in: ${candidates.join(", ")}.`,
    };
  }

  try {
    writeFileSync(target, content, "utf-8");
    return { status: "written", path: target, reason: null };
  } catch (err) {
    const reason = getErrorMessage(err);
    console.warn(`[seed-writeback] could not write seed file ${target}:`, reason);
    return { status: "write-failed", path: target, reason };
  }
}

/**
 * Propagate an approval to its seed file. In the qualified portal the install
 * checkout is read-only (BI-224F56F1), so the authorized source writer writes
 * the applied revision, which the actuator re-reads; elsewhere the portal
 * writes it as before.
 */
export async function propagateSkillSeed(input: { appliedRevisionId: string; category: string; skillId: string; content: string },
  writeThroughWriter?: (revisionId: string) => Promise<{ ok: boolean; status: string; path?: string } | null>,
): Promise<SkillSeedWriteResult> {
  const viaWriter = writeThroughWriter
    ?? (async (revisionId: string) => (await import("@/lib/self-upgrade/source-writer-actuator")).writeSkillSeedThroughWriter(revisionId));
  const written = await viaWriter(input.appliedRevisionId);
  if (!written) return writeSkillSeed(input.category, input.skillId, input.content);
  if (written.ok && written.path) return { status: "written", path: `${repoRoot()}/${written.path}`, reason: null };
  return written.status === "no-seed-file"
    ? { status: "no-seed-file", path: null, reason: "No seed file exists for this skill in the install checkout." }
    : { status: "write-failed", path: null, reason: "The authorized source writer did not write the seed file." };
}

/** Actuator side: the applied revision as the database holds it now. */
export async function readAppliedSkillRevision(revisionId: string): Promise<AppliedSkillRevision | null> {
  const { prisma } = await import("@dpf/db");
  const revision = await prisma.skillRevision.findUnique({
    where: { revisionId },
    select: { skillId: true, version: true, content: true, proposalId: true,
      skill: { select: { category: true, skillMdContent: true } } },
  });
  if (!revision?.proposalId) return null;
  const [proposal, latest] = await Promise.all([
    prisma.improvementProposal.findUnique({ where: { proposalId: revision.proposalId }, select: { status: true } }),
    prisma.skillRevision.findFirst({ where: { skillId: revision.skillId }, orderBy: { version: "desc" }, select: { version: true } }),
  ]);
  return {
    skillId: revision.skillId,
    category: revision.skill.category,
    content: revision.content,
    proposalStatus: proposal?.status ?? null,
    isLatest: latest?.version === revision.version,
    matchesDefinition: revision.skill.skillMdContent === revision.content,
  };
}
