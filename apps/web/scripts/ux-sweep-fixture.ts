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
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { Prisma, prisma } from "@dpf/db";

import { convergeUxSweepFixture } from "./ux-sweep-fixture-core.mjs";
import { SWEEP_ROUTE_PARAMS_REL } from "@/lib/ux-budget/route-shells";

void (async () => {
  try {
    const result = await convergeUxSweepFixture(prisma, new Date(), {
      dbNull: Prisma.DbNull,
    });
    console.error(
      result.setupChanged
        ? `[ux-sweep-fixture] marked platform setup complete (${result.setupProgressId})`
        : `[ux-sweep-fixture] platform setup already complete (${result.setupProgressId})`,
    );
    console.error(
      `[ux-sweep-fixture] refreshed ${result.refreshedRuntimeTargets} running root-portal heartbeat(s)`,
    );
    // BI-DE67A3EC: publish the ids this fixture minted so the sweep can resolve a
    // dynamic route's path. Written even when empty, so a stale file from an
    // earlier run can never make an unminted route look resolvable.
    const params: Record<string, string> = {};
    if (result.workCase?.caseKey) {
      params["/workspace/cases/[caseKey]"] = `/workspace/cases/${result.workCase.caseKey}`;
    }
    const paramsPath = join(process.cwd(), "..", "..", SWEEP_ROUTE_PARAMS_REL);
    mkdirSync(dirname(paramsPath), { recursive: true });
    writeFileSync(paramsPath, `${JSON.stringify({ routes: params }, null, 2)}\n`);
    console.error(
      result.workCase?.caseKey
        ? `[ux-sweep-fixture] resolved ${Object.keys(params).length} dynamic route(s)`
        : `[ux-sweep-fixture] no dynamic route resolved (${result.workCase?.reason ?? "unknown"})`,
    );
    console.error(
      "[ux-sweep-fixture] converged weekly-digest inputs " +
        `(memory=${result.convergedWeeklyDigestInputs.coworkerMemoryNotes}, ` +
        `research=${result.convergedWeeklyDigestInputs.researchProposals}, ` +
        `unlinked-defers=${result.convergedWeeklyDigestInputs.unlinkedDeferredDecisions})`,
    );
  } catch (err) {
    console.error("[ux-sweep-fixture] failed:", err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();
