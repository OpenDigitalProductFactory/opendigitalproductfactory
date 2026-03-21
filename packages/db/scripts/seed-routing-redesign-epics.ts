// One-off script: seed the 6 routing redesign epics (EP-INF-003 through EP-INF-007)
// Run from repo root: pnpm --filter @dpf/db exec tsx scripts/seed-routing-redesign-epics.ts
import { prisma } from "../src/client";

const epics = [
  {
    epicId: "EP-INF-003",
    title: "Provider Model Registry",
    description:
      "Adapter-based model card extraction for all providers. Metadata-driven dimension scores, " +
      "pricing, capabilities, and model classification. Drift detection via rawMetadataHash. " +
      "Backfill function for existing profiles.",
    status: "done",
  },
  {
    epicId: "EP-INF-004",
    title: "Rate Limits & Capacity Management",
    description:
      "In-memory rate tracker with sliding-window token/request counting. Capacity pre-flight " +
      "checks integrated into routing pipeline. Rate-limit response learning (429/Retry-After). " +
      "Exponential backoff recovery scheduler.",
    status: "done",
  },
  {
    epicId: "EP-INF-005a",
    title: "Contract-Based Selection",
    description:
      "RequestContract type capturing modality, tool requirements, token budgets, sensitivity, " +
      "and quality posture. Deterministic inferContract() from raw request context. " +
      "routeEndpointV2 pipeline with cost-per-success ranking replacing dimension scoring.",
    status: "done",
  },
  {
    epicId: "EP-INF-005b",
    title: "Execution Recipes",
    description:
      "ExecutionRecipe DB model with provider-specific settings, tool policy, and response policy. " +
      "Seed recipe builder deriving settings from model card + contract. Recipe loader with " +
      "champion/challenger selection. RoutedExecutionPlan attached to RouteDecision.",
    status: "done",
  },
  {
    epicId: "EP-INF-006",
    title: "Adaptive Loop & Evaluation Realignment",
    description:
      "Reward signal computation from outcome signals (latency, token efficiency, tool accuracy, " +
      "user satisfaction). Route outcome recording. Recipe performance tracking with EMA smoothing. " +
      "Champion-challenger exploration with promotion/demotion. Golden test realignment trigger.",
    status: "done",
  },
  {
    epicId: "EP-INF-007",
    title: "Routing Redesign Activation",
    description:
      "Wire routeEndpointV2 into the live agent-coworker call site with legacy fallback. " +
      "Seed execution recipes for all active model profiles. Backfill ModelCard fields. " +
      "Create backlog entries for the full routing redesign initiative.",
    status: "in-progress",
  },
];

async function main() {
  for (const def of epics) {
    const epic = await prisma.epic.upsert({
      where: { epicId: def.epicId },
      create: {
        epicId: def.epicId,
        title: def.title,
        description: def.description,
        status: def.status,
        ...(def.status === "done" ? { completedAt: new Date() } : {}),
      },
      update: {
        title: def.title,
        description: def.description,
        status: def.status,
        ...(def.status === "done" ? { completedAt: new Date() } : {}),
      },
    });
    console.log(`  ${epic.epicId}: ${epic.title} → ${epic.status}`);
  }

  // Link all epics to the foundational portfolio if it exists
  const foundational = await prisma.portfolio.findUnique({
    where: { slug: "foundational" },
  });
  if (foundational) {
    for (const def of epics) {
      const epic = await prisma.epic.findUnique({ where: { epicId: def.epicId } });
      if (!epic) continue;
      await prisma.epicPortfolio.upsert({
        where: {
          epicId_portfolioId: { epicId: epic.id, portfolioId: foundational.id },
        },
        create: { epicId: epic.id, portfolioId: foundational.id },
        update: {},
      });
    }
    console.log(`\nLinked all epics to foundational portfolio.`);
  }

  console.log("\nDone. 6 routing redesign epics seeded.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
