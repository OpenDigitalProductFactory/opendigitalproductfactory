// Seed-parity helper for the governed Hermes-style learning loop.
//
// "Fix the seed, not the runtime path" (per the standing engineering rule):
// when an approved proposal mutates SkillDefinition.skillMdContent, the
// matching seed file under skills/<category>/<name>.skill.md should be
// updated in the same PR — otherwise a fresh install reverts the change.
// This helper detects that drift so the UI can flag it and the operator
// can document the follow-up in the PR.
//
// Pure I/O over the local filesystem. `seedBody: null` is NOT self-explaining:
// it means either "the repo isn't checked out next to the app" (benign, the
// normal production case) or "the repo IS here and we still could not locate a
// seed for this skill" (a real warning — drift is undetectable for that skill).
// `seedStatus` distinguishes them; callers must not render the second as normal.
//
// BI-5798BBA3: there are TWO skill corpora and the resolver knew only one.
// Coworker skills live at skills/<category>/<skillId>.skill.md; dev-pack skills
// live at packages/dpf-skill-pack/skills/<skillId>/SKILL.md — a different
// directory AND a different filename convention. Resolving only the first meant
// 38 of 107 SkillDefinition rows never resolved, and they were overwhelmingly
// the dpf-* skills every external coding agent loads. Both are now candidates.

import { existsSync, readFileSync } from "fs";
import { join } from "path";

import { prisma } from "@dpf/db";

/**
 * Resolve the on-disk path of the seed file for a skill. The seed loader
 * uses `skills/<category>/<basename>.skill.md`; basename is derived from
 * the file (not the skillId), so we have to enumerate candidate filenames.
 *
 * Convention seen in skills/build/build-page.skill.md: `name: build-page`
 * frontmatter exactly matches the basename. Treat that as authoritative
 * and look for `<skillId>.skill.md` first.
 */
function repoRoot(): string {
  return process.env.DPF_REPO_ROOT ?? join(process.cwd(), "..", "..");
}

/**
 * Every path a skill's seed could legitimately live at, in preference order:
 * the coworker corpus first, then the dev-pack layout.
 */
export function resolveSeedPathCandidates(category: string, skillId: string): string[] {
  const root = repoRoot();
  return [
    join(root, "skills", category, `${skillId}.skill.md`),
    join(root, "packages", "dpf-skill-pack", "skills", skillId, "SKILL.md"),
  ];
}

/**
 * The seed path for a skill: the first candidate that exists on disk, else the
 * primary candidate so the caller still has something to name in a log.
 */
export function resolveSeedPath(category: string, skillId: string): string {
  const candidates = resolveSeedPathCandidates(category, skillId);
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

/** Is a repo checkout reachable at all? Distinguishes benign from real absence. */
function isRepoAvailable(): boolean {
  return existsSync(repoRoot());
}

/**
 * Why a drift check landed where it did. `missing-in-repo` is a WARNING — the
 * repo is present and we still found no seed, so drift for this skill cannot be
 * detected at all. `repo-unavailable` is the benign production case.
 */
export type SkillSeedStatus =
  | "in-sync"
  | "drifted"
  | "missing-in-repo"
  | "repo-unavailable"
  | "skill-unknown";

export type SkillSeedDrift = {
  /** True iff the seed body matches SkillDefinition.skillMdContent verbatim. */
  inSync: boolean;
  /** Why this result — never render `missing-in-repo` as normal. */
  seedStatus: SkillSeedStatus;
  /** Whether a repo checkout was reachable when the check ran. */
  repoAvailable: boolean;
  /** Every path checked, so a log can say where we actually looked. */
  candidatePaths: string[];
  /** SkillDefinition.skillMdContent (or null if the skill is missing). */
  dbBody: string | null;
  /** Seed file body, or null if the file could not be located/read. */
  seedBody: string | null;
  /** Where the helper looked; useful in logs when seedBody is null. */
  seedPath: string;
};

/**
 * Compare a skill's DB body against its on-disk seed. Normalises CRLF →
 * LF so Windows-checked-out repos don't false-flag. The helper does NOT
 * mutate anything; it only reports.
 */
export async function getSkillSeedDrift(skillId: string): Promise<SkillSeedDrift> {
  const skill = await prisma.skillDefinition.findUnique({
    where: { skillId },
    select: { skillId: true, category: true, skillMdContent: true },
  });
  if (!skill) {
    return {
      inSync: false,
      seedStatus: "skill-unknown",
      repoAvailable: isRepoAvailable(),
      candidatePaths: [],
      dbBody: null,
      seedBody: null,
      seedPath: "",
    };
  }

  // ONE existence pass over the candidates: probe each candidate exactly once and
  // read the first hit. Probing here and again via resolveSeedPath() would double
  // the filesystem calls for no gain.
  const candidatePaths = resolveSeedPathCandidates(skill.category, skill.skillId);
  const foundPath = candidatePaths.find((candidate) => existsSync(candidate)) ?? null;
  const seedPath = foundPath ?? candidatePaths[0];
  let seedBody: string | null = null;
  if (foundPath) {
    try {
      seedBody = readFileSync(foundPath, "utf-8");
    } catch (err) {
      console.warn(
        `[seed-parity] could not read seed file ${foundPath}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (seedBody === null) {
    // No seed found. WHICH kind of absence decides whether the operator should
    // be reassured or warned, so resolve it explicitly rather than letting the
    // surface guess from `seedBody: null`.
    const repoAvailable = isRepoAvailable();
    return {
      inSync: false,
      seedStatus: repoAvailable ? "missing-in-repo" : "repo-unavailable",
      repoAvailable,
      candidatePaths,
      dbBody: skill.skillMdContent,
      seedBody: null,
      seedPath,
    };
  }

  const normalise = (s: string) => s.replace(/\r\n/g, "\n").trim();
  const inSync = normalise(skill.skillMdContent) === normalise(seedBody);

  return {
    inSync,
    seedStatus: inSync ? "in-sync" : "drifted",
    repoAvailable: true,
    candidatePaths,
    dbBody: skill.skillMdContent,
    seedBody,
    seedPath,
  };
}
