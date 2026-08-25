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

import { writeFileSync } from "fs";

import { getErrorMessage } from "@/lib/shared/get-error-message";

import { resolveSeedPathCandidates } from "./seed-parity";
import { existsSync } from "fs";

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
  if (!existsSync(repoRoot())) {
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
