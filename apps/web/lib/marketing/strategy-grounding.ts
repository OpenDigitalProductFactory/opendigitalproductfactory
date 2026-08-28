// Marketing strategy grounding (BI-06BB96F0).
//
// THE DEFECT THIS CLOSES. `recordMarketingStrategistReview` in lib/marketing.ts
// is the only `prisma.marketingStrategy.update` call in the codebase, and its
// payload covers seven fields: status, primaryChannels, secondaryChannels,
// reviewCadence, lastReviewedAt, nextReviewAt, specialistNotes. It does not
// touch targetSegments, idealCustomerProfiles, proofAssets, differentiators,
// constraints, geographicScope or seasonalityNotes.
//
// Those are written once at bootstrap ("Bootstrapped from Organization,
// BusinessContext, and StorefrontConfig") and were unreachable for the rest of
// the install's life. No tool, action or UI could set them. That matters
// because the drafter reads exactly those fields — draft-builder.ts takes
// targetSegments[0], falls back to idealCustomerProfiles[0], and reads
// proofAssets[0] — so on an install where they are empty, every marketing
// asset is generated against no audience and no proof. determineStaleAreas()
// already reported "Target segments need definition"; the platform could
// diagnose the gap and had no way to close it.
//
// WHY THIS IS SEPARATE FROM A REVIEW. A review is the strategist's periodic
// recommendation — what to do next, and it supersedes the last one. Grounding
// is the durable business fact underneath it: who this organization serves and
// what proof it has. Those have different authors (the operator knows the
// grounding; the coworker proposes the review), different lifetimes, and
// different truth conditions, so they are not folded into one write.
//
// This module lives here rather than in lib/marketing.ts because that file is
// size-baselined at 1369 lines and may shrink but never grow.

import { prisma } from "@dpf/db";
import type { Prisma } from "@dpf/db";
import type {
  MarketingConstraintSummary,
  MarketingNamedItem,
  MarketingProfile,
  MarketingProofAsset,
} from "@/lib/marketing";

/** The durable business facts a marketing plan has to stand on. */
export type MarketingGroundingInput = {
  primaryGoal?: string | null;
  geographicScope?: string | null;
  seasonalityNotes?: string | null;
  targetSegments?: MarketingNamedItem[];
  idealCustomerProfiles?: MarketingProfile[];
  proofAssets?: MarketingProofAsset[];
  differentiators?: string[];
  constraints?: MarketingConstraintSummary | null;
};

/**
 * The three fields the drafter actually reads. A plan missing any of them
 * produces copy about nobody, which is the failure this gate exists to stop.
 */
export const GROUNDING_REQUIRED_FIELDS = Object.freeze([
  "targetSegments",
  "idealCustomerProfiles",
  "proofAssets",
]);

export type GroundingAssessment = {
  grounded: boolean;
  missing: string[];
  /** True when the row still looks like the untouched archetype bootstrap. */
  isBootstrapStub: boolean;
  reason: string;
};

type AssessableStrategy = {
  targetSegments: unknown[];
  idealCustomerProfiles: unknown[];
  proofAssets: unknown[];
  lastReviewedAt: Date | null;
  sourceSummary: string | null;
};

/**
 * Decide whether a strategy can support generation. Pure so the gate is
 * testable without a database, and so a caller can explain the refusal.
 *
 * A bootstrap stub is recognised by lastReviewedAt === null on a row that
 * carries a sourceSummary: the bootstrap writes the summary and never sets a
 * review date, so the pair is a reliable "nobody has touched this" signal.
 */
export function assessMarketingGrounding(strategy: AssessableStrategy): GroundingAssessment {
  const missing: string[] = [];
  if (strategy.targetSegments.length === 0) missing.push("targetSegments");
  if (strategy.idealCustomerProfiles.length === 0) missing.push("idealCustomerProfiles");
  if (strategy.proofAssets.length === 0) missing.push("proofAssets");

  const isBootstrapStub = strategy.lastReviewedAt === null && Boolean(strategy.sourceSummary);
  const grounded = missing.length === 0;

  if (grounded) {
    return { grounded, missing, isBootstrapStub, reason: "Strategy carries audience and proof." };
  }

  const label = missing.join(", ");
  return {
    grounded,
    missing,
    isBootstrapStub,
    reason: isBootstrapStub
      ? `This marketing plan is still the starting template — ${label} were never filled in. Anything generated from it would describe a generic organization rather than this one.`
      : `The marketing plan is missing ${label}, so generated work would not be grounded in a real audience.`,
  };
}

/**
 * Persist grounding facts. Only supplied fields are written, so a partial
 * interview can be captured across several turns without a later round
 * blanking what an earlier one established.
 */
export async function recordMarketingGrounding(input: {
  grounding: MarketingGroundingInput;
  strategyId: string;
}): Promise<{ strategyId: string; updatedFields: string[]; message: string }> {
  const g = input.grounding;
  const data: Prisma.MarketingStrategyUpdateInput = {};
  const updatedFields: string[] = [];

  const setScalar = (key: "primaryGoal" | "geographicScope" | "seasonalityNotes") => {
    const value = g[key];
    if (value === undefined) return;
    const trimmed = typeof value === "string" ? value.trim() : null;
    // An explicit null clears the field; an empty string is treated as "no
    // answer given", not as an instruction to erase what is already there.
    if (trimmed === "") return;
    data[key] = trimmed;
    updatedFields.push(key);
  };
  setScalar("primaryGoal");
  setScalar("geographicScope");
  setScalar("seasonalityNotes");

  const setJson = (
    key: "targetSegments" | "idealCustomerProfiles" | "proofAssets",
    value: unknown[] | undefined,
  ) => {
    if (value === undefined || value.length === 0) return;
    data[key] = value as Prisma.InputJsonValue;
    updatedFields.push(key);
  };
  setJson("targetSegments", g.targetSegments);
  setJson("idealCustomerProfiles", g.idealCustomerProfiles);
  setJson("proofAssets", g.proofAssets);

  if (g.differentiators !== undefined && g.differentiators.length > 0) {
    data.differentiators = g.differentiators;
    updatedFields.push("differentiators");
  }

  if (g.constraints !== undefined && g.constraints !== null) {
    data.constraints = g.constraints as Prisma.InputJsonValue;
    updatedFields.push("constraints");
  }

  if (updatedFields.length === 0) {
    return {
      strategyId: input.strategyId,
      updatedFields,
      message: "No grounding supplied — nothing was changed.",
    };
  }

  // Stamp the review clock so the row stops reading as an untouched bootstrap
  // stub once a human has actually answered something.
  data.lastReviewedAt = new Date();

  await prisma.marketingStrategy.update({
    where: { strategyId: input.strategyId },
    data,
  });

  return {
    strategyId: input.strategyId,
    updatedFields,
    message: `Recorded ${updatedFields.length} grounding field${updatedFields.length === 1 ? "" : "s"}: ${updatedFields.join(", ")}.`,
  };
}
