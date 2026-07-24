import { createHash } from "crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Prisma, PrismaClient } from "../generated/client/client";

export const MARK_DPF_PLATFORM_PROFILE_ID = "mark-dpf-platform";
export const MARK_DPF_PLATFORM_VERSION_ID = "mark-dpf-platform-v1";
export const PLAN_READINESS_DOMAIN_CLASS = "plan-readiness";

type SeedProfile = {
  profileId: string;
  name: string;
  kind: string;
  scope: Prisma.InputJsonValue;
  fallbackProfileId: string | null;
  defaultResolver: Prisma.InputJsonValue;
  autonomyPolicy: Prisma.InputJsonValue;
  status: string;
};

type SeedVersion = {
  versionId: string;
  profileId: string;
  versionNumber: number;
  materialFingerprint: string;
  changeSummary: string;
};

type SeedMaterial = {
  materialId: string;
  profileId: string;
  profileVersionId: string;
  sourceType: string;
  sourceRef: Prisma.InputJsonValue;
  scope: Prisma.InputJsonValue;
  domainClass: string;
  direction: string;
  domains: string[];
  freshness: string;
  evidenceGrade: string;
  lastValidatedAt: Date;
  confidenceWeight: number;
  reviewStatus: string;
  promotionState: string;
  summary: string;
};

export type DecisionPerspectiveSeed = {
  profile: SeedProfile;
  version: SeedVersion;
  materials: SeedMaterial[];
};

type DecisionPerspectiveSeedClient = Pick<
  PrismaClient,
  "decisionPerspectiveProfile" | "decisionPerspectiveProfileVersion" | "perspectiveMaterial"
>;

const seedDate = new Date("2026-05-17T00:00:00.000Z");

const SOURCE_MATERIALS = [
  {
    slug: "architecture-over-shortcuts",
    path: "docs/founder-kernel/wiki/principles/architecture-over-shortcuts.md",
    summary: "Choose the architecturally sound solution over quick fixes that create future autonomy debt.",
  },
  {
    slug: "never-fabricate",
    path: "docs/founder-kernel/wiki/principles/never-fabricate.md",
    summary: "Ground claims in code, specs, or live state rather than plausible memory.",
  },
  {
    slug: "no-assumptions",
    path: "docs/founder-kernel/wiki/principles/no-assumptions.md",
    summary: "Resolve ambiguity by inspecting the environment before acting confidently.",
  },
  {
    // Migrated out of the kernel to the data-architect corpus (BI-5FE47130);
    // the path moved with it. The slug recorded here is the *material* key used
    // by this seed, not the WikiPage slug, so it stays stable across the move.
    slug: "live-state-over-seed-data",
    path: "docs/professions/data-architect/wiki/live-state-over-seed-data.md",
    summary: "Use live runtime or database state as the authority for current operational truth.",
  },
  {
    slug: "build-gate-mandatory",
    path: "docs/founder-kernel/wiki/principles/build-gate-mandatory.md",
    summary: "Treat tests, build, UX verification, and migration application as the definition of done.",
  },
  {
    slug: "diversity-of-thought",
    path: "docs/founder-kernel/wiki/principles/diversity-of-thought.md",
    summary: "Preserve constructive conflict and competing perspectives before synthesis.",
  },
];

function fingerprintMaterials(materials: Array<{ sourceRef: Prisma.InputJsonValue }>): string {
  const refs = materials
    .map((material) => material.sourceRef)
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return createHash("sha256").update(JSON.stringify(refs)).digest("hex");
}

export function buildDecisionPerspectiveSeed(): DecisionPerspectiveSeed {
  const materials: SeedMaterial[] = SOURCE_MATERIALS.map((source) => ({
    materialId: `${MARK_DPF_PLATFORM_PROFILE_ID}:${source.slug}`,
    profileId: MARK_DPF_PLATFORM_PROFILE_ID,
    profileVersionId: MARK_DPF_PLATFORM_VERSION_ID,
    sourceType: "principle",
    sourceRef: {
      path: source.path,
      principleSlug: source.slug,
      principleDirection: "support",
    },
    scope: {
      routes: ["/build"],
      products: ["dpf-platform"],
    },
    domainClass: PLAN_READINESS_DOMAIN_CLASS,
    direction: "support",
    domains: [PLAN_READINESS_DOMAIN_CLASS, "platform-product"],
    freshness: "current",
    evidenceGrade: "A",
    lastValidatedAt: seedDate,
    confidenceWeight: 1,
    reviewStatus: "approved",
    promotionState: "promoted",
    summary: source.summary,
  }));

  return {
    profile: {
      profileId: MARK_DPF_PLATFORM_PROFILE_ID,
      name: "Mark / DPF Platform",
      kind: "platform",
      scope: {
        routes: ["/build"],
        products: ["dpf-platform"],
        domains: [PLAN_READINESS_DOMAIN_CLASS, "platform-product"],
      },
      fallbackProfileId: null,
      defaultResolver: { type: "build-studio-owner" },
      autonomyPolicy: {
        allowRecommendation: true,
        allowArbitration: false,
        maxRiskForArbitration: "low",
        minimumConfidenceForRecommendation: 0.55,
        minimumConfidenceForArbitration: 0.9,
      },
      status: "active",
    },
    version: {
      versionId: MARK_DPF_PLATFORM_VERSION_ID,
      profileId: MARK_DPF_PLATFORM_PROFILE_ID,
      versionNumber: 1,
      materialFingerprint: fingerprintMaterials(materials),
      changeSummary: "Initial Mark / DPF platform decision perspective profile.",
    },
    materials,
  };
}

// ─── Profession profile seeding (WSID Phase 1 — BI-3AC81394) ────────────────

type ProfessionFamilyEntry = {
  professionKey: string;
  label: string;
  roles: string[];
  contextSlugs: string[];
};

function loadProfessionFamilies(): ProfessionFamilyEntry[] {
  const registryPath = join(__dirname, "../../../docs/professions/registry.json");
  const raw = readFileSync(registryPath, "utf-8");
  const data = JSON.parse(raw) as { families: ProfessionFamilyEntry[] };
  return data.families;
}

/**
 * Seed one empty DecisionPerspectiveProfile per registered profession family
 * (kind="profession"). Profiles without corpus still get a row so their
 * `defer` counts function as the demand signal for Phase 6 rollout order.
 * Idempotent upsert; loud skip-logging per the silent-seed-skips audit pattern.
 */
export async function seedProfessionProfiles(
  db: DecisionPerspectiveSeedClient,
): Promise<{ seeded: number; skipped: number }> {
  const families = loadProfessionFamilies();
  let seeded = 0;
  let skipped = 0;

  for (const family of families) {
    const profileId = `wsid-${family.professionKey}`;
    const versionId = `wsid-${family.professionKey}-v1`;

    try {
      await db.decisionPerspectiveProfile.upsert({
        where: { profileId },
        update: {
          name: family.label,
          kind: "profession",
          scope: {
            domains: ["professional-practice"],
            professionKey: family.professionKey,
            roles: family.roles,
          },
          fallbackProfileId: MARK_DPF_PLATFORM_PROFILE_ID,
          status: "active",
        },
        create: {
          profileId,
          name: family.label,
          kind: "profession",
          scope: {
            domains: ["professional-practice"],
            professionKey: family.professionKey,
            roles: family.roles,
          },
          fallbackProfileId: MARK_DPF_PLATFORM_PROFILE_ID,
          defaultResolver: { type: "build-studio-owner" },
          autonomyPolicy: {
            allowRecommendation: true,
            allowArbitration: false,
            maxRiskForArbitration: "low",
            minimumConfidenceForRecommendation: 0.55,
            minimumConfidenceForArbitration: 0.9,
          },
          status: "active",
        },
      });

      await db.decisionPerspectiveProfileVersion.upsert({
        where: { versionId },
        update: { changeSummary: `Empty profession profile for ${family.label}.` },
        create: {
          versionId,
          profileId,
          versionNumber: 1,
          materialFingerprint: createHash("sha256")
            .update(`${profileId}-v1-empty`)
            .digest("hex"),
          changeSummary: `Empty profession profile for ${family.label}.`,
        },
      });

      await db.decisionPerspectiveProfile.update({
        where: { profileId },
        data: { currentVersionId: versionId },
      });

      seeded++;
    } catch (err) {
      console.warn(
        `[seed-profession-profiles] SKIP ${profileId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      skipped++;
    }
  }

  if (skipped > 0) {
    console.warn(
      `[seed-profession-profiles] ${skipped} profile(s) skipped — check warnings above.`,
    );
  }

  return { seeded, skipped };
}

export async function seedDecisionPerspective(db: DecisionPerspectiveSeedClient): Promise<{
  profileId: string;
  versionId: string;
  materialCount: number;
}> {
  const seed = buildDecisionPerspectiveSeed();

  await db.decisionPerspectiveProfile.upsert({
    where: { profileId: seed.profile.profileId },
    update: {
      name: seed.profile.name,
      kind: seed.profile.kind,
      scope: seed.profile.scope,
      fallbackProfileId: seed.profile.fallbackProfileId,
      defaultResolver: seed.profile.defaultResolver,
      autonomyPolicy: seed.profile.autonomyPolicy,
      status: seed.profile.status,
    },
    create: seed.profile,
  });

  await db.decisionPerspectiveProfileVersion.upsert({
    where: { versionId: seed.version.versionId },
    update: {
      materialFingerprint: seed.version.materialFingerprint,
      changeSummary: seed.version.changeSummary,
    },
    create: seed.version,
  });

  for (const material of seed.materials) {
    await db.perspectiveMaterial.upsert({
      where: { materialId: material.materialId },
      update: {
        profileVersionId: material.profileVersionId,
        sourceType: material.sourceType,
        sourceRef: material.sourceRef,
        scope: material.scope,
        domainClass: material.domainClass,
        direction: material.direction,
        domains: material.domains,
        freshness: material.freshness,
        evidenceGrade: material.evidenceGrade,
        lastValidatedAt: material.lastValidatedAt,
        confidenceWeight: material.confidenceWeight,
        reviewStatus: material.reviewStatus,
        promotionState: material.promotionState,
        summary: material.summary,
      },
      create: material,
    });
  }

  await db.decisionPerspectiveProfile.update({
    where: { profileId: seed.profile.profileId },
    data: { currentVersionId: seed.version.versionId },
  });

  return {
    profileId: seed.profile.profileId,
    versionId: seed.version.versionId,
    materialCount: seed.materials.length,
  };
}
