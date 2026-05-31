// apps/web/lib/self-upgrade/impact/install-signals.ts
//
// Collect the install-state signals used to score upstream commits' relevance
// to THIS install. All reads go through prisma; missing rows return empty
// values rather than throwing — relevance scoring degrades gracefully when
// the install has no storefront yet.
//
// Customization paths today come from FeaturePack manifests — these are the
// only DB-visible record of what an install has customized vs. stock. The
// future `client/<id>` install-branch (spec §5.0.1) will give a richer
// signal; this collector is shaped to absorb it as another input layer
// without changing the public type.

import { prisma } from "@dpf/db";
import type { InstallSignals } from "./types";

// Conservative cap so a runaway customization list can't poison scoring;
// well above any realistic install's customization count.
const MAX_CUSTOMIZATION_PATHS = 200;
const MAX_OPEN_ISSUE_KEYWORDS = 50;

/**
 * Tiny stopword list — words too generic to be a useful keyword signal.
 * Issue summaries hand us natural English; without filtering we'd light up
 * every commit that mentioned "the" or "fix".
 */
const STOPWORDS = new Set([
  "the", "and", "for", "with", "this", "that", "from", "into", "when",
  "have", "has", "are", "was", "were", "but", "not", "all", "any",
  "fix", "bug", "issue", "error", "fails", "failed", "broken",
  "feature", "feat", "chore", "doc", "docs",
  "platform", "portal", "dpf", "install", "user", "users",
]);

function keywordsFromSummary(summary: string): string[] {
  return summary
    .split(/[^A-Za-z0-9]+/)
    .map((w) => w.toLowerCase())
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

type ManifestShape = {
  files?: unknown;
  paths?: unknown;
  changedFiles?: unknown;
};

function extractManifestPaths(manifest: unknown): string[] {
  if (!manifest || typeof manifest !== "object") return [];
  const m = manifest as ManifestShape;
  const candidates: unknown[] = [];
  if (Array.isArray(m.files)) candidates.push(...m.files);
  if (Array.isArray(m.paths)) candidates.push(...m.paths);
  if (Array.isArray(m.changedFiles)) candidates.push(...m.changedFiles);
  return candidates
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .map((p) => p.trim());
}

export type InstallSignalsDeps = {
  /** Override for tests / non-prisma callers. */
  loader?: () => Promise<InstallSignals>;
};

export async function collectInstallSignals(deps: InstallSignalsDeps = {}): Promise<InstallSignals> {
  if (deps.loader) return deps.loader();

  // Storefront archetype — single source of truth for portal industry.
  const storefront = await prisma.storefrontConfig.findFirst({
    select: { archetypeId: true },
  });
  const archetypeId = storefront?.archetypeId ?? null;

  const organization = await prisma.organization.findFirst({
    select: { industry: true },
  });
  const industry = organization?.industry ?? null;

  // FeaturePacks — anything not strictly "stock" is a customization signal.
  // We exclude `status="stock"` if anyone ever introduces that label; today
  // the default is "local". Either way, every FeaturePack row represents
  // operator-visible customization.
  const packs = await prisma.featurePack.findMany({
    select: {
      manifest: true,
      sourceVertical: true,
      applicableVerticals: true,
      status: true,
    },
  });

  const customizationPaths = new Set<string>();
  const customizationVerticals = new Set<string>();
  for (const pack of packs) {
    for (const p of extractManifestPaths(pack.manifest)) {
      customizationPaths.add(p);
      if (customizationPaths.size >= MAX_CUSTOMIZATION_PATHS) break;
    }
    if (pack.sourceVertical) customizationVerticals.add(pack.sourceVertical);
    for (const v of pack.applicableVerticals) customizationVerticals.add(v);
  }

  // Open quality issues — surface keywords so commits whose subjects match
  // pop up the relevance ranking.
  const issues = await prisma.portfolioQualityIssue.findMany({
    where: { status: "open" },
    select: { summary: true },
    take: 100, // bounded
  });

  const keywordCounter = new Map<string, number>();
  for (const issue of issues) {
    for (const kw of keywordsFromSummary(issue.summary)) {
      keywordCounter.set(kw, (keywordCounter.get(kw) ?? 0) + 1);
    }
  }
  // Take the most frequent keywords — these are the install's "hot" themes.
  const openIssueKeywords = [...keywordCounter.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_OPEN_ISSUE_KEYWORDS)
    .map(([kw]) => kw);

  // PR labels relevant to this install — coarse heuristic: include the
  // archetype id and any customization vertical as labels we'd consider a
  // match. We deliberately do NOT pull from an external label registry here;
  // that's a heuristic, and we err on the side of fewer false positives.
  const relevantPrLabels: string[] = [];
  if (archetypeId) relevantPrLabels.push(archetypeId.toLowerCase());
  for (const v of customizationVerticals) relevantPrLabels.push(v.toLowerCase());

  return {
    archetypeId,
    industry,
    customizationPaths: [...customizationPaths],
    customizationVerticals: [...customizationVerticals],
    openIssueKeywords,
    relevantPrLabels,
  };
}
