// Semantic review source sensitivity (BI-B76DC66C).
//
// A semantic review sends the committed diff of this install's managed
// repository. When that repository is public on GitHub and the install
// publishes its work there, the diff is public source: it routes like Build
// Studio's code turns ("development"), so any cleared provider may review it.
// Founder direction, 2026-11-05: "Dev work is 100% public."
//
// Anything short of proof keeps the "internal" floor: no repository named, a
// private or unreadable repository, or an install that keeps its changes
// private. Payload screening still runs on every review, so a secret, a
// personal record or a financial identifier inside a public diff is still
// classified and kept local.

import { parseManagedRepositoryInput, readRepositoryVisibility, type RepositoryVisibility } from "@/lib/forge/managed-repository-access";
import type { ForgeRepository } from "@/lib/forge/types";

export type SemanticReviewSourceSensitivity = "development" | "internal";

export type SemanticReviewSourceDb = {
  platformDevConfig: {
    findUnique(args: {
      where: { id: string };
      select: { upstreamRemoteUrl: true; contributionMode: true };
    }): Promise<{ upstreamRemoteUrl: string | null; contributionMode: string | null } | null>;
  };
};

export type SemanticReviewSourceDeps = {
  db?: SemanticReviewSourceDb;
  readVisibility?: (repo: Pick<ForgeRepository, "owner" | "repo">) => Promise<RepositoryVisibility>;
  now?: () => number;
};

/** Modes in which the install's changes are never published upstream. */
const PRIVATE_CONTRIBUTION_MODES = new Set(["private", "fork_only"]);

/** A public answer is reused this long; anything else is asked again next time. */
export const SOURCE_VISIBILITY_TTL_MS = 5 * 60 * 1000;

let cached: { key: string; at: number } | null = null;

export function resetSemanticReviewSourceSensitivityCache(): void {
  cached = null;
}

export async function resolveSemanticReviewSourceSensitivity(
  deps: SemanticReviewSourceDeps = {},
): Promise<SemanticReviewSourceSensitivity> {
  try {
    const db = deps.db ?? (await loadDb());
    const config = await db.platformDevConfig.findUnique({
      where: { id: "singleton" },
      select: { upstreamRemoteUrl: true, contributionMode: true },
    });
    if (!config || PRIVATE_CONTRIBUTION_MODES.has(config.contributionMode ?? "")) return "internal";
    const repository = parseManagedRepositoryInput(config.upstreamRemoteUrl);
    if (!repository) return "internal";
    const now = (deps.now ?? Date.now)();
    if (cached?.key === repository.fullName && now - cached.at < SOURCE_VISIBILITY_TTL_MS) return "development";
    const visibility = await (deps.readVisibility ?? readRepositoryVisibility)(repository);
    // Only a public answer is cached: a rate-limited or failed read must not
    // pin reviews local for five minutes, and must not be trusted either.
    cached = visibility === "public" ? { key: repository.fullName, at: now } : null;
    return visibility === "public" ? "development" : "internal";
  } catch {
    return "internal";
  }
}

async function loadDb(): Promise<SemanticReviewSourceDb> {
  const { prisma } = await import("@dpf/db");
  return prisma as unknown as SemanticReviewSourceDb;
}
