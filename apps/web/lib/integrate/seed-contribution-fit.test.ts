import { describe, expect, it } from "vitest";

import {
  buildContributionSeedDeltaManifest,
  evaluateSeedContributionFit,
  findCanonicalSeedContentPaths,
} from "./seed-contribution-fit";

const cleanEvidence = {
  sanitization: { passed: true, mustFixCount: 0 },
  parameterization: { scope: "already_generic" as const, overallVerdict: "pass" as const },
  verticals: {
    sourceVertical: "unknown",
    applicableVerticals: [],
  },
  securityPassed: true,
};

describe("findCanonicalSeedContentPaths", () => {
  it("detects every canonical seed family and excludes tests", () => {
    expect(findCanonicalSeedContentPaths([
      "prompts/reviewer/code-review.prompt.md",
      "skills/build/reviewer.skill.md",
      "docs/founder-kernel/wiki/principles/never-fabricate.md",
      "packages/dpf-skill-pack/skills/dpf-tdd/SKILL.md",
      "packages/db/data/seed-voices/en-US.json",
      "packages/db/src/seed-skills.ts",
      "packages/db/src/governance-seed.ts",
      "packages/db/src/taxonomy-seed-entries.ts",
      "packages/db/prisma/seed-task-requirements.ts",
      "packages/storefront-templates/src/archetypes/home-services.ts",
      "packages/finance-templates/src/chart-of-accounts.ts",
      "apps/web/lib/onboarding/seed-market-offer.ts",
      "apps/web/lib/storefront/seed-booking-defaults.ts",
      "apps/web/lib/routing/recipe-seeder.ts",
      "packages/db/src/seed-skills.test.ts",
      "apps/web/lib/storefront/seed-booking-defaults.test.ts",
      "apps/web/components/CustomerTable.tsx",
    ])).toEqual([
      "prompts/reviewer/code-review.prompt.md",
      "skills/build/reviewer.skill.md",
      "docs/founder-kernel/wiki/principles/never-fabricate.md",
      "packages/dpf-skill-pack/skills/dpf-tdd/SKILL.md",
      "packages/db/data/seed-voices/en-US.json",
      "packages/db/src/seed-skills.ts",
      "packages/db/src/governance-seed.ts",
      "packages/db/src/taxonomy-seed-entries.ts",
      "packages/db/prisma/seed-task-requirements.ts",
      "packages/storefront-templates/src/archetypes/home-services.ts",
      "packages/finance-templates/src/chart-of-accounts.ts",
      "apps/web/lib/onboarding/seed-market-offer.ts",
      "apps/web/lib/storefront/seed-booking-defaults.ts",
      "apps/web/lib/routing/recipe-seeder.ts",
    ]);
  });
});

describe("evaluateSeedContributionFit", () => {
  it("does not require a decision for a code-only contribution", () => {
    expect(evaluateSeedContributionFit({
      changedFiles: ["apps/web/components/CustomerTable.tsx"],
      ...cleanEvidence,
    })).toMatchObject({
      touchesSeededContent: false,
      changedSeedPaths: [],
      decision: null,
      distributionScope: null,
      mergeEligible: true,
    });
  });

  it("allows clean generic seed content as a global default", () => {
    expect(evaluateSeedContributionFit({
      changedFiles: ["prompts/reviewer/code-review.prompt.md"],
      ...cleanEvidence,
    })).toMatchObject({
      decision: "global-default",
      distributionScope: "global-default",
      mergeEligible: true,
    });
  });

  it("scopes archetype templates to their applicable categories", () => {
    expect(evaluateSeedContributionFit({
      changedFiles: ["packages/storefront-templates/src/archetypes/pet-services.ts"],
      ...cleanEvidence,
      parameterization: { scope: "parameterizable", overallVerdict: "pass" },
      verticals: {
        sourceVertical: "pet-services",
        applicableVerticals: [
          { category: "pet-services", relevance: "primary" as const },
          { category: "field-services", relevance: "applicable" as const },
        ],
      },
    })).toMatchObject({
      decision: "archetype-scoped",
      distributionScope: "archetype-scoped",
      applicableArchetypeCategories: ["pet-services", "field-services"],
      mergeEligible: true,
    });
  });

  it("keeps one-off seed defaults local to the contributing install", () => {
    expect(evaluateSeedContributionFit({
      changedFiles: ["packages/db/src/seed-storefront-archetypes.ts"],
      ...cleanEvidence,
      parameterization: { scope: "one_off", overallVerdict: "pass" },
    })).toMatchObject({
      decision: "install-local-only",
      distributionScope: null,
      mergeEligible: false,
    });
  });

  it("requires parameterization when review evidence contains org-specific content", () => {
    expect(evaluateSeedContributionFit({
      changedFiles: ["packages/db/src/seed-skills.ts"],
      ...cleanEvidence,
      sanitization: { passed: false, mustFixCount: 2 },
    })).toMatchObject({
      decision: "parameterize-first",
      mergeEligible: false,
    });
  });

  it("rejects a seed delta that fails the security review", () => {
    expect(evaluateSeedContributionFit({
      changedFiles: ["skills/build/reviewer.skill.md"],
      ...cleanEvidence,
      securityPassed: false,
    })).toMatchObject({
      decision: "reject-as-seed",
      mergeEligible: false,
    });
  });
});

describe("buildContributionSeedDeltaManifest", () => {
  it("carries scope and source contribution evidence", () => {
    const seedFit = evaluateSeedContributionFit({
      changedFiles: ["packages/db/src/seed-banking-compliance.ts"],
      ...cleanEvidence,
      parameterization: { scope: "parameterizable", overallVerdict: "pass" },
      verticals: {
        sourceVertical: "financial-services",
        applicableVerticals: [
          { category: "financial-services", relevance: "primary" as const },
        ],
      },
    });

    expect(buildContributionSeedDeltaManifest(seedFit, {
      packId: "FP-1234",
      buildId: "FB-5678",
      prNumber: 42,
      prUrl: "https://github.com/example/repo/pull/42",
      reviewedAt: "2026-07-11T00:00:00.000Z",
    })).toEqual({
      schemaVersion: 1,
      changedPaths: ["packages/db/src/seed-banking-compliance.ts"],
      distributionScope: "vertical-scoped",
      applicableArchetypeCategories: [],
      applicableVerticals: ["financial-services"],
      sourceContribution: {
        packId: "FP-1234",
        buildId: "FB-5678",
        prNumber: 42,
        prUrl: "https://github.com/example/repo/pull/42",
        sourceVertical: "financial-services",
      },
      seedFitDecision: "vertical-scoped",
      mergeEligible: true,
      reviewedAt: "2026-07-11T00:00:00.000Z",
    });
  });
});
