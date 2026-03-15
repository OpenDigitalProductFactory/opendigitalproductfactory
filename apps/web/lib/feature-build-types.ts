// apps/web/lib/feature-build-types.ts
// Pure types and helpers for the Build Studio. No server imports.

import * as crypto from "crypto";

// ─── Types ───────────────────────────────────────────────────────────────────

export type FeatureBrief = {
  title: string;
  description: string;
  portfolioContext: string;
  targetRoles: string[];
  inputs: string[];
  dataNeeds: string;
  acceptanceCriteria: string[];
};

export type BuildPhase = "ideate" | "plan" | "build" | "review" | "ship" | "complete" | "failed";

export type FeatureBuildRow = {
  id: string;
  buildId: string;
  title: string;
  description: string | null;
  portfolioId: string | null;
  brief: FeatureBrief | null;
  plan: Record<string, unknown> | null;
  phase: BuildPhase;
  sandboxId: string | null;
  sandboxPort: number | null;
  diffSummary: string | null;
  diffPatch: string | null;
  codingProvider: string | null;
  threadId: string | null;
  digitalProductId: string | null;
  product: { productId: string; version: string; backlogCount: number } | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
};

export type FeaturePackRow = {
  id: string;
  packId: string;
  title: string;
  description: string | null;
  portfolioContext: string | null;
  version: string;
  status: string;
  buildId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CodingCapability = "excellent" | "adequate" | "insufficient";

// ─── Constants ───────────────────────────────────────────────────────────────

export const PHASE_ORDER: BuildPhase[] = [
  "ideate", "plan", "build", "review", "ship", "complete", "failed",
];

export const PHASE_LABELS: Record<BuildPhase, string> = {
  ideate:   "Ideate",
  plan:     "Plan",
  build:    "Build",
  review:   "Review",
  ship:     "Ship",
  complete: "Complete",
  failed:   "Failed",
};

export const PHASE_COLOURS: Record<BuildPhase, string> = {
  ideate:   "#a78bfa",
  plan:     "#38bdf8",
  build:    "#fbbf24",
  review:   "#fb923c",
  ship:     "#4ade80",
  complete: "#4ade80",
  failed:   "#f87171",
};

export const CODING_CAPABILITY_COLOURS: Record<CodingCapability, string> = {
  excellent:    "#4ade80",
  adequate:     "#fbbf24",
  insufficient: "#f87171",
};

export const VISIBLE_PHASES: BuildPhase[] = ["ideate", "plan", "build", "review", "ship"];

// ─── Phase Transitions ──────────────────────────────────────────────────────

const ALLOWED_TRANSITIONS: Record<BuildPhase, BuildPhase[]> = {
  ideate:   ["plan", "failed"],
  plan:     ["build", "failed"],
  build:    ["review", "failed"],
  review:   ["ship", "failed"],
  ship:     ["complete", "failed"],
  complete: [],
  failed:   [],
};

export function canTransitionPhase(from: BuildPhase, to: BuildPhase): boolean {
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

// ─── Validation ──────────────────────────────────────────────────────────────

export type ValidationResult = { valid: boolean; errors: string[] };

export function validateFeatureBrief(brief: FeatureBrief): ValidationResult {
  const errors: string[] = [];
  if (!brief.title.trim()) errors.push("title is required");
  if (!brief.description.trim()) errors.push("description is required");
  return { valid: errors.length === 0, errors };
}

// ─── ID Generation ───────────────────────────────────────────────────────────

export function generateBuildId(): string {
  return `FB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

export function generatePackId(): string {
  return `FP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

// ─── Version Bumping ──────────────────────────────────────────────────────

export type VersionBump = "major" | "minor" | "patch";

export function bumpVersion(current: string, bump: VersionBump): string {
  const parts = current.split(".");
  if (parts.length !== 3) return "1.0.0";

  const major = parseInt(parts[0]!, 10);
  const minor = parseInt(parts[1]!, 10);
  const patch = parseInt(parts[2]!, 10);

  if (isNaN(major) || isNaN(minor) || isNaN(patch)) return "1.0.0";

  switch (bump) {
    case "major":
      return `${major + 1}.0.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    case "minor":
    default:
      return `${major}.${minor + 1}.0`;
  }
}

// ─── Portfolio Search Types ──────────────────────────────────────────────────

export type SearchMatch = {
  id: string;
  name: string;
  slug?: string;
  description: string | null;
  relevanceScore: number;
  context?: string;
};

export type PortfolioSearchResult = {
  taxonomyMatches: SearchMatch[];
  productMatches: SearchMatch[];
  buildMatches: SearchMatch[];
  backlogMatches: SearchMatch[];
};

// ─── Complexity Assessment Types ─────────────────────────────────────────────

export type ComplexityDimension =
  | "taxonomySpan"
  | "dataEntities"
  | "integrations"
  | "novelty"
  | "regulatory"
  | "costEstimate"
  | "techDebt";

export type ComplexityScores = Record<ComplexityDimension, 1 | 2 | 3>;

export type ComplexityPath = "simple" | "moderate" | "complex";

export type ComplexityResult = {
  total: number;
  path: ComplexityPath;
  scores: ComplexityScores;
};

// ─── Decomposition Types ─────────────────────────────────────────────────────

export type BuildOrBuyRecommendation = "build" | "buy" | "integrate";

export type FeatureSetEntry = {
  title: string;
  description: string;
  type: "feature_build" | "digital_product";
  estimatedBuilds: number;
  recommendation: BuildOrBuyRecommendation;
  rationale: string;
  techDebtNote: string | null;
};

export type DecompositionPlan = {
  epicTitle: string;
  epicDescription: string;
  featureSets: FeatureSetEntry[];
};
