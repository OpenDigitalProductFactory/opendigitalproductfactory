// apps/web/lib/self-upgrade/impact/score.ts
//
// Pure relevance scoring. Pipeline contract: every commit becomes an
// ImpactItem; the LLM never reorders, so this ordering is what the operator
// sees. Higher score = more impactful for THIS install.
//
// score = baseWeight(type, breaking) × relevanceMultiplier(install signals)
//
// baseWeight encodes the "what kind of change" axis (a breaking change
// outranks a fix outranks a docs commit). relevanceMultiplier amplifies
// commits whose scope, files, or PR labels match install state — an HVAC
// install with a `field-service` customization should see field-service
// changes near the top even when the upstream-wide impact bucket is "fix".
//
// Reasons are accumulated verbatim so the operator UI can show *why* an item
// landed where it did, with no LLM rewriting.

import { CATEGORY_RANK } from "./classify";
import type {
  ImpactItem,
  ImpactItemReason,
  InstallSignals,
  ParsedCommit,
  PrEnrichment,
} from "./types";

const BASE_WEIGHT: Record<ParsedCommit["category"], number> = {
  breaking: 100,
  // A security fix is the one thing besides a breaking change an operator
  // should never scroll past, so it outweighs a feature.
  security: 80,
  feature: 50,
  performance: 30,
  fix: 25,
  // Dependency bumps outweigh docs and internal upkeep: they change what the
  // product actually runs on, and are the usual suspect when an upgrade
  // regresses something. Still far below anything an operator asked for.
  dependency: 12,
  documentation: 6,
  maintenance: 5,
  other: 8,
};

const RELEVANCE_INCREMENTS = {
  archetypeScopeMatch: 0.5,
  industryScopeMatch: 0.3,
  customizationPathOverlap: 0.6,
  customizationVerticalMatch: 0.4,
  openIssueKeywordHit: 0.5,
  prLabelMatch: 0.3,
} as const;

function lowercase(value: string | null | undefined): string {
  return (value ?? "").toLowerCase();
}

function pathOverlap(commitFiles: string[], customizationPaths: string[]): string[] {
  if (commitFiles.length === 0 || customizationPaths.length === 0) return [];
  const hits = new Set<string>();
  for (const file of commitFiles) {
    const f = file.toLowerCase();
    for (const cp of customizationPaths) {
      const c = cp.toLowerCase();
      if (!c) continue;
      // Match on prefix (directory) or exact file path.
      if (f === c || f.startsWith(c.endsWith("/") ? c : `${c}/`)) {
        hits.add(file);
        break;
      }
    }
  }
  return [...hits];
}

function keywordHit(haystack: string, needle: string): boolean {
  if (!needle) return false;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

export type ScoreInput = {
  commits: ParsedCommit[];
  signals: InstallSignals;
  enrichmentByPr: Map<number, PrEnrichment>;
};

export function scoreCommits(input: ScoreInput): ImpactItem[] {
  const { commits, signals, enrichmentByPr } = input;
  const archetype = lowercase(signals.archetypeId);
  const industry = lowercase(signals.industry);
  const customizationVerticals = signals.customizationVerticals.map(lowercase).filter(Boolean);
  const issueKeywords = signals.openIssueKeywords.map((k) => k.trim()).filter(Boolean);
  const relevantLabels = new Set(signals.relevantPrLabels.map(lowercase));

  return commits.map((commit) => {
    const reasons: ImpactItemReason[] = [];
    let multiplier = 1;

    if (commit.breaking) reasons.push({ kind: "breaking-change" });

    const scopeText = lowercase(commit.scope);
    if (archetype && scopeText && scopeText.includes(archetype)) {
      reasons.push({ kind: "archetype-match", archetypeId: signals.archetypeId! });
      multiplier += RELEVANCE_INCREMENTS.archetypeScopeMatch;
    }
    if (industry && scopeText && scopeText.includes(industry)) {
      reasons.push({ kind: "industry-match", industry: signals.industry! });
      multiplier += RELEVANCE_INCREMENTS.industryScopeMatch;
    }

    const overlap = pathOverlap(commit.files, signals.customizationPaths);
    const touchesCustomizations = overlap.length > 0;
    if (touchesCustomizations) {
      reasons.push({ kind: "customization-path-overlap", paths: overlap });
      multiplier += RELEVANCE_INCREMENTS.customizationPathOverlap;
    }

    if (scopeText) {
      for (const vert of customizationVerticals) {
        if (scopeText.includes(vert)) {
          reasons.push({ kind: "customization-vertical-match", vertical: vert });
          multiplier += RELEVANCE_INCREMENTS.customizationVerticalMatch;
          break; // only one vertical bump per item
        }
      }
    }

    // Issue keywords match against the description (subject) only — body is
    // not reliably available on squashed commits.
    if (issueKeywords.length > 0) {
      for (const kw of issueKeywords) {
        if (keywordHit(commit.description, kw)) {
          reasons.push({ kind: "open-issue-keyword", keyword: kw });
          multiplier += RELEVANCE_INCREMENTS.openIssueKeywordHit;
          break; // only one keyword bump per item
        }
      }
    }

    const pr = commit.prNumber != null ? enrichmentByPr.get(commit.prNumber) : undefined;
    if (pr && pr.labels.length > 0 && relevantLabels.size > 0) {
      for (const label of pr.labels) {
        if (relevantLabels.has(label)) {
          multiplier += RELEVANCE_INCREMENTS.prLabelMatch;
          break;
        }
      }
    }

    if (reasons.length === 0) reasons.push({ kind: "base-weight" });

    const base = BASE_WEIGHT[commit.category];
    const score = Math.round(base * multiplier);

    return {
      sha: commit.sha,
      description: commit.description,
      type: commit.type,
      scope: commit.scope,
      category: commit.category,
      breaking: commit.breaking,
      prNumber: commit.prNumber,
      prTitle: pr?.title ?? null,
      prLabels: pr?.labels ?? [],
      score,
      reasons,
      touchesCustomizations,
    };
  });
}

/**
 * Sort scored items by score desc, then category rank, then newer-first by
 * SHA position in the input (caller passes commits oldest→newest from
 * `git log --reverse`, so we use array index for stability).
 */
export function orderByImpact(items: ImpactItem[]): ImpactItem[] {
  const indexed = items.map((item, index) => ({ item, index }));
  indexed.sort((a, b) => {
    if (a.item.score !== b.item.score) return b.item.score - a.item.score;
    if (a.item.category !== b.item.category) {
      return CATEGORY_RANK[a.item.category] - CATEGORY_RANK[b.item.category];
    }
    return b.index - a.index; // newer first (later in `git log --reverse` => higher index)
  });
  return indexed.map((entry) => entry.item);
}
