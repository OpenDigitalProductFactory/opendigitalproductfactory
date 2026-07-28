/**
 * CI fixture for the UX route budget sweep — EP-UX-SYSTEM (BI-BD81682A).
 *
 * WHY THIS EXISTS: `apps/web/app/(shell)/layout.tsx` redirects every authenticated
 * surface to /setup while `isFirstRun()` is true, and the seed alone does not clear
 * it — the seeded bootstrap platform org is deliberately excluded from the org count
 * (it has no storefrontConfig / businessContext / setup progress / branding), so a
 * freshly seeded install still looks like a first run. The first sweep run proved it:
 * 208 of 226 routes redirected to /setup and nothing was measured.
 *
 * So the fixture marks platform setup COMPLETE, which is the honest state for a
 * sweep: we want to measure the portal an owner actually works in, not the onboarding
 * wizard. Deliberately NOT `DPF_ENVIRONMENT=sandbox` — that flag exists to make Build
 * Studio previews viewable and changes other behaviour; borrowing it to dodge a
 * redirect would mean measuring a subtly different application.
 *
 * Idempotent: safe to run against an already-set-up install.
 *
 *   pnpm --filter web ux:sweep-fixture
 */
import { prisma } from "@dpf/db";

import { convergeUxSweepFixture } from "./ux-sweep-fixture-core.mjs";

void (async () => {
  try {
    const result = await convergeUxSweepFixture(prisma);
    console.error(
      result.setupChanged
        ? `[ux-sweep-fixture] marked platform setup complete (${result.setupProgressId})`
        : `[ux-sweep-fixture] platform setup already complete (${result.setupProgressId})`,
    );
    console.error(
      `[ux-sweep-fixture] refreshed ${result.refreshedRuntimeTargets} running root-portal heartbeat(s)`,
    );
  } catch (err) {
    console.error("[ux-sweep-fixture] failed:", err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();
