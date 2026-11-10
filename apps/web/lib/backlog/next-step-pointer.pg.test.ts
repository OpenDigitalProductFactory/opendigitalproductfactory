import { beforeAll, describe, expect, it } from "vitest";

import { INTEGRATION_COVERAGE_MATRIX } from "@/lib/tools/integration-coverage-matrix";
import { buildBookkeeperAccountantWorkLane } from "@/lib/finance/accountant-work-lane";
import { buildQuickBooksReadinessDescriptor } from "@/lib/integrations/quickbooks/readiness";
import { declaredItemIds, type NextStepPointer } from "./next-step-pointer";

// The resolve half of BI-5BF97BAA.
//
// The static guard (scripts/check-rendered-backlog-pointers.mjs) proves a
// declared pointer can only reach a reader through the resolver. It cannot prove
// that a declared id still names something — that needs the backlog.
//
// So this test carries the other half, and it is DB-gated on purpose. No CI
// workflow declares a Postgres service, and check-no-ambient-host-tests.mjs
// exists because BI-BFDCE0A9 was a test that reached for an ambient Postgres and
// gave two verdicts on one tree. The house idiom is to skip when the resource is
// absent, so this SKIPS in CI and RUNS wherever DATABASE_URL is set — the local
// gate, and any install with a live backlog.
//
// It passes trivially while every declared next step states intent. It bites the
// moment someone writes a real id that does not resolve.
const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

/** Every next step declared anywhere in the surfaces this defect touched. */
function declaredNextSteps(): NextStepPointer[] {
  const lane = buildBookkeeperAccountantWorkLane({
    status: "connected",
    companyName: "Resolve Contract Co",
    realmId: "realm-resolve-contract",
    lastErrorMsg: null,
    lastTestedAt: "2026-08-29T00:00:00.000Z",
    environment: "sandbox",
  });
  const readiness = buildQuickBooksReadinessDescriptor({ connection: null });

  return [
    ...INTEGRATION_COVERAGE_MATRIX.map((row) => row.nextStep),
    ...lane.providerBoundaries.map((boundary) => boundary.nextStep),
    lane.nextWorkflow.nextStep,
    ...(readiness.importReview ? [readiness.importReview.nextStep] : []),
  ];
}

// Deliberately OUTSIDE the DB gate. The shape of a declared next step is
// checkable anywhere, so it should not go dark in an environment without a
// database — only the resolve check genuinely needs one.
describe("declared next steps are well formed", () => {
  it("every declared next step carries something a reader can act on", () => {
    const declared = declaredNextSteps();
    expect(declared.length).toBeGreaterThan(0);

    for (const pointer of declared) {
      if (pointer.kind === "open") {
        expect(pointer.intent.trim().length).toBeGreaterThan(0);
        // An id-shaped "intent" is the defect wearing the other shape.
        expect(pointer.intent).not.toMatch(/^BI-/);
      } else {
        expect(pointer.itemId).toMatch(/^BI-/);
      }
    }
  });
});

describeDatabase("declared next steps resolve against the live backlog", () => {
  let prisma: typeof import("@dpf/db").prisma;

  beforeAll(async () => {
    ({ prisma } = await import("@dpf/db"));
  });

  it("every declared backlog id names an item the backlog holds", async () => {
    const claimed = declaredItemIds(declaredNextSteps());

    const filed = claimed.length
      ? await prisma.backlogItem.findMany({
          where: { itemId: { in: claimed } },
          select: { itemId: true },
        })
      : [];

    const found = new Set(filed.map((row) => row.itemId));
    const dangling = claimed.filter((itemId) => !found.has(itemId));

    expect(
      dangling,
      dangling.length
        ? `these next-step ids name nothing in the backlog: ${dangling.join(", ")}. ` +
          "Either file the item, or state the intent with openIntent() instead."
        : "",
    ).toEqual([]);
  });
});
