import { settleBootSyncs } from "@/lib/runtime/measurement-runtime";

type RenderRelevantBootReconcilers = {
  infrastructurePruneSchedule: () => Promise<unknown>;
  archetypeWorkforce: () => Promise<unknown>;
  commercialCatalog: () => Promise<unknown>;
  discoveryEstate: () => Promise<unknown>;
};

const productionReconcilers: RenderRelevantBootReconcilers = {
  async infrastructurePruneSchedule() {
    const { ensureInfraPruneJob } = await import("@/lib/actions/infra-prune");
    await ensureInfraPruneJob();
  },
  async archetypeWorkforce() {
    const { backfillArchetypeWorkforceOnBoot } = await import(
      "@/lib/onboarding/seed-archetype-workforce"
    );
    await backfillArchetypeWorkforceOnBoot();
  },
  async commercialCatalog() {
    const { backfillCommercialCatalogOnBoot } = await import(
      "@/lib/onboarding/backfill-commercial-catalog-on-boot"
    );
    await backfillCommercialCatalogOnBoot();
  },
  async discoveryEstate() {
    const { runDiscoveryOnBootSelfHeal } = await import(
      "@/lib/onboarding/discovery-on-boot-self-heal"
    );
    await runDiscoveryOnBootSelfHeal();
  },
};

/**
 * Boot self-heals whose writes change DB-backed route rendering. Keeping the
 * ordered list outside instrumentation makes the measurement settlement
 * decision explicit and gives the exact wiring a behavior-test seam.
 */
export async function settleRenderRelevantBootReconcilers(
  measurementRuntime: boolean,
  reconcilers: RenderRelevantBootReconcilers = productionReconcilers,
): Promise<void> {
  await settleBootSyncs(measurementRuntime, [
    reconcilers.infrastructurePruneSchedule,
    reconcilers.archetypeWorkforce,
    reconcilers.commercialCatalog,
    reconcilers.discoveryEstate,
  ]);
}
