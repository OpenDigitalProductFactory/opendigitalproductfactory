import { readFileSync } from "fs";
import { join } from "path";
import type { PrismaClient } from "../generated/client/client";

export type LicenseRequirementSeedRecord = {
  requirementRefId: string;
  countryCode: string;
  stateProvinceCode: string | null;
  jurisdictionLabel: string;
  authorityName: string;
  authorityType: string;
  requirementType: string;
  scopeLevel: string;
  archetypeCategories: string[];
  activityTags: string[];
  summary: string;
  officialWebsiteUrl: string | null;
  applicationUrl: string | null;
  renewalUrl: string | null;
  helpUrl: string | null;
  displayRuleSummary: string | null;
  renewalCadenceHint: string | null;
  sourceUrls: string[];
  sourceKind: string;
  confidence: string;
  staleAfterDays: number;
  tags: string[];
};

type SeedConfig = {
  generatedAt: string;
  entries: LicenseRequirementSeedRecord[];
};

const DATA_DIR = join(__dirname, "..", "data");

function loadJson<T>(filename: string): T {
  return JSON.parse(readFileSync(join(DATA_DIR, filename), "utf-8")) as T;
}

export function buildDefaultLicenseRequirementSeed(): LicenseRequirementSeedRecord[] {
  const config = loadJson<SeedConfig>("license_requirement_reference.json");
  return [...config.entries].sort((a, b) => a.requirementRefId.localeCompare(b.requirementRefId));
}

export async function seedLicenseRequirements(prisma: PrismaClient): Promise<void> {
  const config = loadJson<SeedConfig>("license_requirement_reference.json");
  const researchedAt = new Date(config.generatedAt);
  const records = buildDefaultLicenseRequirementSeed();

  console.log(`[seed-license] upserting ${records.length} licensing requirement references...`);

  for (const record of records) {
    await prisma.licenseRequirementReference.upsert({
      where: { requirementRefId: record.requirementRefId },
      update: {
        countryCode: record.countryCode,
        stateProvinceCode: record.stateProvinceCode,
        jurisdictionLabel: record.jurisdictionLabel,
        authorityName: record.authorityName,
        authorityType: record.authorityType,
        requirementType: record.requirementType,
        scopeLevel: record.scopeLevel,
        archetypeCategories: record.archetypeCategories,
        activityTags: record.activityTags,
        summary: record.summary,
        officialWebsiteUrl: record.officialWebsiteUrl,
        applicationUrl: record.applicationUrl,
        renewalUrl: record.renewalUrl,
        helpUrl: record.helpUrl,
        displayRuleSummary: record.displayRuleSummary,
        renewalCadenceHint: record.renewalCadenceHint,
        sourceUrls: record.sourceUrls,
        sourceKind: record.sourceKind,
        lastResearchedAt: researchedAt,
        confidence: record.confidence,
        staleAfterDays: record.staleAfterDays,
        tags: record.tags,
      },
      create: {
        requirementRefId: record.requirementRefId,
        countryCode: record.countryCode,
        stateProvinceCode: record.stateProvinceCode,
        jurisdictionLabel: record.jurisdictionLabel,
        authorityName: record.authorityName,
        authorityType: record.authorityType,
        requirementType: record.requirementType,
        scopeLevel: record.scopeLevel,
        archetypeCategories: record.archetypeCategories,
        activityTags: record.activityTags,
        summary: record.summary,
        officialWebsiteUrl: record.officialWebsiteUrl,
        applicationUrl: record.applicationUrl,
        renewalUrl: record.renewalUrl,
        helpUrl: record.helpUrl,
        displayRuleSummary: record.displayRuleSummary,
        renewalCadenceHint: record.renewalCadenceHint,
        sourceUrls: record.sourceUrls,
        sourceKind: record.sourceKind,
        lastResearchedAt: researchedAt,
        confidence: record.confidence,
        staleAfterDays: record.staleAfterDays,
        tags: record.tags,
      },
    });
  }

  console.log("[seed-license] licensing requirement references done");
}
