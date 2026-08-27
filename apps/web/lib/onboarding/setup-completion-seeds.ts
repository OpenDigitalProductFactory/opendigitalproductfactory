// The setup-completion seed chain, extracted from setup-progress.ts so the
// boot-time WWWD backfill (backfill-org-wwwd-on-boot.ts) can run the SAME
// sequence for installs that completed setup before these seeders existed.
//
// Order matters: the mission prompt + WWWD corpus must exist before the risk
// envelope is projected onto the org profile, and the market/portfolio seeds
// feed the operating-model pages. Every step is idempotent and the caller is
// expected to treat the whole chain as fail-open (onboarding completion and
// boot must never block on a seeding error).

import { prisma, projectArchetypeSupply } from "@dpf/db";
import { seedOrgWwwdCorpus } from "./seed-org-wwwd-corpus";
import { seedPortfolioDecomposition } from "./seed-portfolio-decomposition";
import { seedMarketOffer } from "./seed-market-offer";
import { seedOrgOperatingModelPages } from "./seed-org-operating-model-pages";
import { seedRiskPosture } from "./seed-risk-posture";
import { seedArchetypeWorkforce } from "./seed-archetype-workforce";
import { applyRiskEnvelopeToOrgProfile } from "./apply-risk-envelope-to-profile";
import { applyMissionPrompt } from "./apply-mission-prompt";

/**
 * Persist the captured mission into the company-mission prompt (visible to
 * every coworker), seed the per-org WWWD corpus, persist the per-org portfolio
 * decomposition (BI-2D452667), seed the archetype-derived market offer into
 * the Goods and Services for Sale portfolio (BI-4503E6B9), apply the archetype's
 * worker classes and work locations (BI-A30152B6), project archetype supply, and apply the seeded risk posture to the org WWWD profile.
 *
 * Idempotent — safe to re-run on setup re-completion, replay, or boot backfill.
 */
export async function runSetupCompletionSeeds(organizationId: string): Promise<void> {
  const bc = await prisma.businessContext.findUnique({
    where: { organizationId },
    select: { mission: true },
  });

  await applyMissionPrompt({ mission: bc?.mission ?? null });
  await seedOrgWwwdCorpus({ organizationId });
  await seedPortfolioDecomposition({ organizationId });
  await seedMarketOffer({ organizationId });
  // The active archetype's worker classes and work locations. Runs here so an
  // install that completed setup before this existed acquires them on the next
  // boot backfill (BI-A30152B6).
  await seedArchetypeWorkforce({ organizationId });
  await projectArchetypeSupply({ organizationId });
  // Runs after the portfolio/market/supply seeds so the persisted operating-
  // model map it reads is complete (BI-44526F3E Phase B).
  await seedOrgOperatingModelPages({ organizationId });
  await seedRiskPosture({ organizationId });
  // P1: project the seeded posture onto the org WWWD profile's autonomy policy
  // (runs after the profile exists + the posture is set; balanced = no change).
  await applyRiskEnvelopeToOrgProfile({ organizationId });
}
