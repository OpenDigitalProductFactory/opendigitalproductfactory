import seedContentPaths from "../../../../config/seed-content-paths.json";

export const SEED_CONTRIBUTION_FIT_DECISIONS = [
  "global-default",
  "archetype-scoped",
  "vertical-scoped",
  "parameterize-first",
  "install-local-only",
  "reject-as-seed",
] as const;

export type SeedContributionFitDecision =
  (typeof SEED_CONTRIBUTION_FIT_DECISIONS)[number];

export type SeedDistributionScope = Extract<
  SeedContributionFitDecision,
  "global-default" | "archetype-scoped" | "vertical-scoped"
>;

type VerticalApplicabilityEvidence = {
  category: string;
  relevance: "primary" | "applicable" | "unlikely";
};

export type SeedContributionFitInput = {
  changedFiles: string[];
  sanitization: {
    passed: boolean;
    mustFixCount: number;
  };
  parameterization: {
    scope: "one_off" | "parameterizable" | "already_generic";
    overallVerdict: "pass" | "partial" | "fail";
  };
  verticals: {
    sourceVertical: string;
    applicableVerticals: VerticalApplicabilityEvidence[];
  };
  securityPassed: boolean;
};

export type SeedContributionFitReport = {
  touchesSeededContent: boolean;
  changedSeedPaths: string[];
  decision: SeedContributionFitDecision | null;
  distributionScope: SeedDistributionScope | null;
  applicableArchetypeCategories: string[];
  applicableVerticals: string[];
  sourceVertical: string;
  rationale: string;
  mergeEligible: boolean;
};

export type ContributionSeedDeltaManifest = {
  schemaVersion: 1;
  changedPaths: string[];
  distributionScope: SeedDistributionScope | null;
  applicableArchetypeCategories: string[];
  applicableVerticals: string[];
  sourceContribution: {
    packId: string;
    buildId: string;
    prNumber: number;
    prUrl: string;
    sourceVertical: string;
  };
  seedFitDecision: SeedContributionFitDecision;
  mergeEligible: boolean;
  reviewedAt: string;
};

const directoryPrefixes = seedContentPaths.directoryPrefixes;
const filePatterns = seedContentPaths.filePatterns.map((pattern) => new RegExp(pattern));
const excludePatterns = seedContentPaths.excludePatterns.map((pattern) => new RegExp(pattern));

function normalizeRepoPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^[ab]\//, "");
}

export function isCanonicalSeedContentPath(path: string): boolean {
  const normalized = normalizeRepoPath(path);
  if (!normalized || excludePatterns.some((pattern) => pattern.test(normalized))) {
    return false;
  }
  return directoryPrefixes.some((prefix) => normalized.startsWith(prefix))
    || filePatterns.some((pattern) => pattern.test(normalized));
}

export function findCanonicalSeedContentPaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of paths) {
    const normalized = normalizeRepoPath(path);
    if (!seen.has(normalized) && isCanonicalSeedContentPath(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

function relevantVerticals(verticals: VerticalApplicabilityEvidence[]): string[] {
  return [...new Set(
    verticals
      .filter((vertical) => vertical.relevance !== "unlikely")
      .map((vertical) => vertical.category),
  )];
}

function report(
  input: SeedContributionFitInput,
  changedSeedPaths: string[],
  decision: SeedContributionFitDecision,
  rationale: string,
  applicable: string[],
): SeedContributionFitReport {
  const distributionScope: SeedDistributionScope | null =
    decision === "global-default"
      || decision === "archetype-scoped"
      || decision === "vertical-scoped"
      ? decision
      : null;
  const archetypeScoped = decision === "archetype-scoped" ? applicable : [];
  const verticalScoped = decision === "vertical-scoped" ? applicable : [];

  return {
    touchesSeededContent: true,
    changedSeedPaths,
    decision,
    distributionScope,
    applicableArchetypeCategories: archetypeScoped,
    applicableVerticals: verticalScoped,
    sourceVertical: input.verticals.sourceVertical,
    rationale,
    mergeEligible: distributionScope !== null,
  };
}

export function evaluateSeedContributionFit(
  input: SeedContributionFitInput,
): SeedContributionFitReport {
  const changedSeedPaths = findCanonicalSeedContentPaths(input.changedFiles);
  if (changedSeedPaths.length === 0) {
    return {
      touchesSeededContent: false,
      changedSeedPaths: [],
      decision: null,
      distributionScope: null,
      applicableArchetypeCategories: [],
      applicableVerticals: [],
      sourceVertical: input.verticals.sourceVertical,
      rationale: "The contribution does not change canonical seeded content.",
      mergeEligible: true,
    };
  }

  const applicable = relevantVerticals(input.verticals.applicableVerticals);

  if (!input.securityPassed) {
    return report(
      input,
      changedSeedPaths,
      "reject-as-seed",
      "Seeded content cannot be distributed while the security review is failing.",
      applicable,
    );
  }

  if (input.parameterization.scope === "one_off") {
    return report(
      input,
      changedSeedPaths,
      "install-local-only",
      "The contribution is explicitly one-off, so its seed defaults stay on the contributing install.",
      applicable,
    );
  }

  if (!input.sanitization.passed
    || input.sanitization.mustFixCount > 0
    || input.parameterization.overallVerdict !== "pass") {
    return report(
      input,
      changedSeedPaths,
      "parameterize-first",
      "The review found install-specific content or incomplete parameterization that must be separated from the reusable seed.",
      applicable,
    );
  }

  const changesArchetypeSeed = changedSeedPaths.some((path) =>
    path.includes("/archetypes/") || /(?:^|[-/])archetype(?:s|[-.])/.test(path),
  );
  if (changesArchetypeSeed && applicable.length > 0) {
    return report(
      input,
      changedSeedPaths,
      "archetype-scoped",
      "The clean seed delta changes archetype content and is limited to the reviewed applicable archetype categories.",
      applicable,
    );
  }

  if (input.parameterization.scope === "parameterizable" && applicable.length > 0) {
    return report(
      input,
      changedSeedPaths,
      "vertical-scoped",
      "The clean parameterized seed delta is limited to the reviewed applicable business verticals.",
      applicable,
    );
  }

  return report(
    input,
    changedSeedPaths,
    "global-default",
    "The seed delta is clean, reusable, and has no evidence limiting it to one install, archetype, or vertical.",
    applicable,
  );
}

export function buildContributionSeedDeltaManifest(
  seedFit: SeedContributionFitReport,
  source: {
    packId: string;
    buildId: string;
    prNumber: number;
    prUrl: string;
    reviewedAt: string;
  },
): ContributionSeedDeltaManifest {
  if (!seedFit.touchesSeededContent || !seedFit.decision) {
    throw new Error("Cannot build a seed-delta manifest for a contribution without seed changes.");
  }

  return {
    schemaVersion: 1,
    changedPaths: seedFit.changedSeedPaths,
    distributionScope: seedFit.distributionScope,
    applicableArchetypeCategories: seedFit.applicableArchetypeCategories,
    applicableVerticals: seedFit.applicableVerticals,
    sourceContribution: {
      packId: source.packId,
      buildId: source.buildId,
      prNumber: source.prNumber,
      prUrl: source.prUrl,
      sourceVertical: seedFit.sourceVertical,
    },
    seedFitDecision: seedFit.decision,
    mergeEligible: seedFit.mergeEligible,
    reviewedAt: source.reviewedAt,
  };
}

export function formatSeedContributionFitMarkdown(
  seedFit: SeedContributionFitReport,
): string[] {
  const lines = ["### Seed Contribution Fit", ""];
  if (!seedFit.touchesSeededContent) {
    return [...lines, "- [x] No canonical seeded content changed", ""];
  }

  lines.push(
    `- Decision: **${seedFit.decision}**`,
    `- Fleet-seed eligible: **${seedFit.mergeEligible ? "yes" : "no"}**`,
    `- Rationale: ${seedFit.rationale}`,
    `- Seed paths: ${seedFit.changedSeedPaths.length}`,
    ...seedFit.changedSeedPaths.slice(0, 15).map((path) => `  - \`${path}\``),
  );
  if (seedFit.changedSeedPaths.length > 15) {
    lines.push(`  - ${seedFit.changedSeedPaths.length - 15} more`);
  }
  lines.push("");
  return lines;
}
