// Seed-parity helper for the governed Hermes-style learning loop.
//
// "Fix the seed, not the runtime path" (per the standing engineering rule):
// when an approved proposal mutates SkillDefinition.skillMdContent, the
// matching seed file under skills/<category>/<name>.skill.md should be
// updated in the same PR — otherwise a fresh install reverts the change.
// This helper detects that drift so the UI can flag it and the operator
// can document the follow-up in the PR.
//
// Pure I/O over the local filesystem; the operator surface uses it as a
// best-effort signal — `seedBody: null` means "we couldn't find the seed",
// which on a production install (where the repo is not checked out next
// to the app) is the normal case. The check is meaningful in dev and
// in CI.

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
export function resolveSeedPath(category: string, skillId: string): string {
  const repoRoot = process.env.DPF_REPO_ROOT ?? join(process.cwd(), "..", "..");
  return join(repoRoot, "skills", category, `${skillId}.skill.md`);
}

export type SkillSeedDrift = {
  /** True iff the seed body matches SkillDefinition.skillMdContent verbatim. */
  inSync: boolean;
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
      dbBody: null,
      seedBody: null,
      seedPath: "",
    };
  }

  const seedPath = resolveSeedPath(skill.category, skill.skillId);
  let seedBody: string | null = null;
  try {
    if (existsSync(seedPath)) {
      seedBody = readFileSync(seedPath, "utf-8");
    }
  } catch (err) {
    console.warn(
      `[seed-parity] could not read seed file ${seedPath}:`,
      err instanceof Error ? err.message : err,
    );
  }

  if (seedBody === null) {
    return {
      inSync: false,
      dbBody: skill.skillMdContent,
      seedBody: null,
      seedPath,
    };
  }

  const normalise = (s: string) => s.replace(/\r\n/g, "\n").trim();
  const inSync = normalise(skill.skillMdContent) === normalise(seedBody);

  return {
    inSync,
    dbBody: skill.skillMdContent,
    seedBody,
    seedPath,
  };
}
